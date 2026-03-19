import { NextResponse } from "next/server";
import { OAUTH_STATE_COOKIE, getAppBaseUrl } from "@/lib/auth/config";
import { exchangeCodeForToken, fetchGoogleUserInfo } from "@/lib/auth/googleOAuth";
import { getAuthSessionMaxAgeSeconds } from "@/lib/auth/config";
import { applySessionCookie, createSessionToken } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { authSessions, oauthAccounts, users } from "@/lib/db/schema";
import { applyCsrfCookie, createCsrfToken, getCookieValue } from "@/lib/auth/csrf";
import { logAuthEvent } from "@/lib/auth/audit";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    if (!code || !returnedState) {
      logAuthEvent("oauth_callback_missing_params", { success: false, provider: "google", reason: "missing_code_or_state" });
      return NextResponse.json({ error: "Missing OAuth code/state" }, { status: 400 });
    }
    if (code.length > 4096 || returnedState.length > 512) {
      logAuthEvent("oauth_callback_invalid_params", { success: false, provider: "google", reason: "param_too_long" });
      return NextResponse.json({ error: "Invalid OAuth parameters" }, { status: 400 });
    }

    const stateCookie = getCookieValue(req, OAUTH_STATE_COOKIE);

    if (!stateCookie || stateCookie !== returnedState) {
      logAuthEvent("oauth_callback_invalid_state", { success: false, provider: "google", reason: "state_mismatch" });
      return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
    }

    const token = await exchangeCodeForToken(code);
    const profile = await fetchGoogleUserInfo(token.access_token);
    const normalizedEmail = profile.email.trim().toLowerCase();

    const [userRecord] = await db
      .insert(users)
      .values({
        email: normalizedEmail,
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

    console.info("Google OAuth user upsert:", {
      googleEmail: profile.email,
      normalizedEmail,
      userId: userRecord.id,
      storedEmail: userRecord.email,
      role: userRecord.role,
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
    applyCsrfCookie(response, createCsrfToken());
    response.cookies.set(OAUTH_STATE_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    logAuthEvent("oauth_signin_success", {
      success: true,
      provider: "google",
      userId: userRecord.id,
      email: normalizedEmail,
    });

    return response;
  } catch (error) {
    logAuthEvent("oauth_callback_error", { success: false, provider: "google", reason: "exception" });
    console.error("Google OAuth callback error:", error);
    return NextResponse.json({ error: "Google OAuth callback failed" }, { status: 500 });
  }
}
