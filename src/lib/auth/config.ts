export const AUTH_SESSION_COOKIE = "app_session";
export const OAUTH_STATE_COOKIE = "oauth_state";

export function getAppBaseUrl(): string {
  return process.env.APP_BASE_URL || "http://localhost:3000";
}

export function getGoogleRedirectUri(): string {
  return process.env.GOOGLE_REDIRECT_URI || `${getAppBaseUrl()}/api/auth/callback/google`;
}

export function getAuthSessionSecret(): string {
  const secret = process.env.AUTH_SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("AUTH_SESSION_SECRET is not configured.");
  }
  return secret;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function getAuthSessionMaxAgeSeconds(): number {
  const raw = process.env.AUTH_SESSION_MAX_AGE_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  return 7 * 24 * 60 * 60;
}
