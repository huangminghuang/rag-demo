import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireConversationOwner } from "@/lib/auth/guards";
import { requireCsrf } from "@/lib/auth/csrf";

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(_req: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  if (!isUuid(conversationId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireConversationOwner(conversationId);
  if (!auth.ok) return auth.response;

  const [conversation] = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(eq(conversations.id, auth.conversationId))
    .limit(1);

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ conversation });
}

export async function PATCH(req: Request, context: RouteContext) {
  const csrfError = requireCsrf(req);
  if (csrfError) return csrfError;

  const { conversationId } = await context.params;
  if (!isUuid(conversationId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireConversationOwner(conversationId);
  if (!auth.ok) return auth.response;

  const { title }: { title?: string } = await req.json().catch(() => ({}));
  if (!title || !title.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  const normalizedTitle = title.trim();
  if (normalizedTitle.length > 160) {
    return NextResponse.json({ error: "Title is too long (max 160 chars)" }, { status: 400 });
  }

  const [updated] = await db
    .update(conversations)
    .set({
      title: normalizedTitle,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, auth.conversationId))
    .returning({
      id: conversations.id,
      title: conversations.title,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    });

  return NextResponse.json({ conversation: updated });
}

export async function DELETE(_req: Request, context: RouteContext) {
  const csrfError = requireCsrf(_req);
  if (csrfError) return csrfError;

  const { conversationId } = await context.params;
  if (!isUuid(conversationId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireConversationOwner(conversationId);
  if (!auth.ok) return auth.response;

  await db.delete(conversations).where(eq(conversations.id, auth.conversationId));
  return NextResponse.json({ ok: true });
}
