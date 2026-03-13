import crypto from "node:crypto";
import { getGoogleOAuthCredentials } from "./googleOAuthCredentials";
import { getGoogleRedirectUri } from "./config";

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  id_token?: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
}

export function buildGoogleAuthUrl(state: string): string {
  const { clientId } = getGoogleOAuthCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getGoogleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function createOAuthState(): string {
  return crypto.randomBytes(24).toString("hex");
}

export async function exchangeCodeForToken(code: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = getGoogleOAuthCredentials();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: getGoogleRedirectUri(),
    grant_type: "authorization_code",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google token exchange failed: ${response.status} ${text}`);
  }

  return (await response.json()) as TokenResponse;
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google userinfo fetch failed: ${response.status} ${text}`);
  }

  const user = (await response.json()) as GoogleUserInfo;
  if (!user.sub || !user.email || !user.name) {
    throw new Error("Google userinfo missing required fields.");
  }

  return user;
}
