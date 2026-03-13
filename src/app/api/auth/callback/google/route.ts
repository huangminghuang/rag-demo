import { NextResponse } from "next/server";
import { OAUTH_STATE_COOKIE, getAppBaseUrl } from "@/lib/auth/config";
import { exchangeCodeForToken, fetchGoogleUserInfo } from "@/lib/auth/googleOAuth";
import { getAuthSessionMaxAgeSeconds } from "@/lib/auth/config";
import { applySessionCookie, createSessionToken } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { authSessions, oauthAccounts, users } from "@/lib/db/schema";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    if (!code || !returnedState) {
      return NextResponse.json({ error: "Missing OAuth code/state" }, { status: 400 });
    }

    const cookieHeader = req.headers.get("cookie") || "";
    const stateCookie = cookieHeader
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${OAUTH_STATE_COOKIE}=`))
      ?.split("=")[1];

    if (!stateCookie || stateCookie !== returnedState) {
      return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
    }

    const token = await exchangeCodeForToken(code);
    const profile = await fetchGoogleUserInfo(token.access_token);

    const [userRecord] = await db
      .insert(users)
      .values({
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.picture,
        role: "user",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          name: profile.name,
          avatarUrl: profile.picture,
          updatedAt: new Date(),
        },
      })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        avatarUrl: users.avatarUrl,
        role: users.role,
      });

    await db
      .insert(oauthAccounts)
      .values({
        userId: userRecord.id,
        provider: "google",
        providerAccountId: profile.sub,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [oauthAccounts.provider, oauthAccounts.providerAccountId],
        set: {
          userId: userRecord.id,
          updatedAt: new Date(),
        },
      });

    const sessionToken = createSessionToken({
      id: userRecord.id,
      email: userRecord.email,
      name: userRecord.name,
      picture: userRecord.avatarUrl || undefined,
      role: userRecord.role === "admin" ? "admin" : "user",
    });

    await db.insert(authSessions).values({
      userId: userRecord.id,
      sessionToken,
      expiresAt: new Date(Date.now() + getAuthSessionMaxAgeSeconds() * 1000),
    });

    const response = NextResponse.redirect(`${getAppBaseUrl()}/`);
    applySessionCookie(response, sessionToken);
    response.cookies.set(OAUTH_STATE_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    return response;
  } catch (error) {
    console.error("Google OAuth callback error:", error);
    return NextResponse.json({ error: "Google OAuth callback failed" }, { status: 500 });
  }
}
