import { NextResponse } from "next/server";
import { buildGoogleAuthUrl, createOAuthState } from "@/lib/auth/googleOAuth";
import { OAUTH_STATE_COOKIE, isProduction } from "@/lib/auth/config";

export async function GET() {
  try {
    const state = createOAuthState();
    const authUrl = buildGoogleAuthUrl(state);

    const response = NextResponse.redirect(authUrl);
    response.cookies.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: isProduction(),
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    console.error("Google sign-in start error:", error);
    return NextResponse.json({ error: "Unable to start Google sign-in" }, { status: 500 });
  }
}
