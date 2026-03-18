import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { authSessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { AUTH_SESSION_COOKIE } from "@/lib/auth/config";
import { requireCsrf } from "@/lib/auth/csrf";
import { logAuthEvent } from "@/lib/auth/audit";

export async function POST(req: Request) {
  const csrfError = requireCsrf(req);
  if (csrfError) return csrfError;

  const cookieHeader = req.headers.get("cookie") || "";
  const sessionToken = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${AUTH_SESSION_COOKIE}=`))
    ?.split("=")[1];

  if (sessionToken) {
    await db.delete(authSessions).where(eq(authSessions.sessionToken, sessionToken));
  }

  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  logAuthEvent("signout", { success: true });
  return response;
}
