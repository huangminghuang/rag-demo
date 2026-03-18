import { NextResponse } from "next/server";
import { resolveAuthContext } from "./middleware";
import type { AuthUser } from "./session";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

type RequireUserResult =
  | { ok: true; user: AuthUser }
  | { ok: false; response: NextResponse };

type RequireConversationOwnerResult =
  | { ok: true; user: AuthUser; conversationId: string }
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

export async function requireConversationOwner(conversationId: string): Promise<RequireConversationOwnerResult> {
  const auth = await requireUser();
  if (!auth.ok) {
    return auth;
  }

  const [record] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, auth.user.id)))
    .limit(1);

  if (!record) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not found" }, { status: 404 }),
    };
  }

  return { ok: true, user: auth.user, conversationId: record.id };
}
