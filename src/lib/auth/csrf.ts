import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { isProduction } from "./config";

export const CSRF_COOKIE = "csrf_token";
export const CSRF_HEADER = "x-csrf-token";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function timingSafeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

export function createCsrfToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

export function getCookieValue(req: Request, name: string): string | null {
  const cookieHeader = req.headers.get("cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${name}=`)) continue;
    const value = trimmed.slice(name.length + 1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

export function applyCsrfCookie(response: NextResponse, token: string): void {
  response.cookies.set(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
}

export function requireCsrf(req: Request): NextResponse | null {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return null;

  const cookieToken = getCookieValue(req, CSRF_COOKIE);
  const headerToken = req.headers.get(CSRF_HEADER);

  if (!cookieToken || !headerToken || !timingSafeEqual(cookieToken, headerToken)) {
    return NextResponse.json({ error: "CSRF validation failed" }, { status: 403 });
  }

  return null;
}
