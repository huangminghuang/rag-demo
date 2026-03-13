import { NextResponse } from "next/server";
import { resolveAuthContext } from "./middleware";
import type { AuthUser } from "./session";

type RequireUserResult =
  | { ok: true; user: AuthUser }
  | { ok: false; response: NextResponse };

export async function requireUser(): Promise<RequireUserResult> {
  const { user } = await resolveAuthContext();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true, user };
}

export async function requireRole(role: AuthUser["role"]): Promise<RequireUserResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (auth.user.role !== role) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return auth;
}
