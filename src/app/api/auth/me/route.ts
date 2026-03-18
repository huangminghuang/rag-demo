import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { applyCsrfCookie, createCsrfToken, CSRF_COOKIE, getCookieValue } from "@/lib/auth/csrf";

export async function GET(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const response = NextResponse.json({
    user: {
      id: auth.user.id,
      email: auth.user.email,
      name: auth.user.name,
      picture: auth.user.picture,
      role: auth.user.role,
    },
  });

  const existingCsrf = getCookieValue(req, CSRF_COOKIE);
  if (!existingCsrf) {
    applyCsrfCookie(response, createCsrfToken());
  }

  return response;
}
