import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, getAuthSessionMaxAgeSeconds, getAuthSessionSecret, isProduction } from "./config";
import { db } from "@/lib/db";
import { authSessions, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
  role: "user" | "admin";
}

interface SessionPayload {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  role: "user" | "admin";
  iat: number;
  exp: number;
}

function toBase64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function fromBase64Url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(payloadBase64: string): string {
  const secret = getAuthSessionSecret();
  return toBase64Url(crypto.createHmac("sha256", secret).update(payloadBase64).digest());
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

export function createSessionToken(user: AuthUser): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    role: user.role,
    iat: now,
    exp: now + getAuthSessionMaxAgeSeconds(),
  };
  const payloadBase64 = toBase64Url(JSON.stringify(payload));
  const signature = sign(payloadBase64);
  return `${payloadBase64}.${signature}`;
}

export function parseSessionToken(token: string): AuthUser | null {
  const [payloadBase64, signature] = token.split(".");
  if (!payloadBase64 || !signature) return null;

  const expected = sign(payloadBase64);
  if (!timingSafeEqual(signature, expected)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(fromBase64Url(payloadBase64)) as SessionPayload;
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) return null;

  if (!payload.sub || !payload.email || !payload.name) return null;

  return {
    id: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
    role: payload.role || "user",
  };
}

export async function getCurrentUserFromCookies(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_SESSION_COOKIE)?.value;
  if (!token) return null;

  const parsedUser = parseSessionToken(token);
  if (!parsedUser) return null;

  const [sessionRecord] = await db
    .select({
      userId: authSessions.userId,
      expiresAt: authSessions.expiresAt,
    })
    .from(authSessions)
    .where(eq(authSessions.sessionToken, token))
    .limit(1);

  if (!sessionRecord) return null;
  if (sessionRecord.expiresAt.getTime() <= Date.now()) {
    await db.delete(authSessions).where(eq(authSessions.sessionToken, token));
    return null;
  }
  if (sessionRecord.userId !== parsedUser.id) return null;

  const [userRecord] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, parsedUser.id))
    .limit(1);

  if (!userRecord) return null;

  console.info("Resolved current user from session:", {
    sessionUserId: parsedUser.id,
    sessionEmail: parsedUser.email,
    dbUserId: userRecord.id,
    dbEmail: userRecord.email,
    role: userRecord.role,
  });

  return {
    id: userRecord.id,
    email: userRecord.email,
    name: userRecord.name,
    picture: userRecord.avatarUrl || undefined,
    role: userRecord.role === "admin" ? "admin" : "user",
  };
}

export function applySessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(AUTH_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: getAuthSessionMaxAgeSeconds(),
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(AUTH_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
