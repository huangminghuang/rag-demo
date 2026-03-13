import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireConversationOwner } from "@/lib/auth/guards";

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

export async function GET(_req: Request, context: RouteContext) {
  const { conversationId } = await context.params;
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
  const { conversationId } = await context.params;
  const auth = await requireConversationOwner(conversationId);
  if (!auth.ok) return auth.response;

  const { title }: { title?: string } = await req.json().catch(() => ({}));
  if (!title || !title.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const [updated] = await db
    .update(conversations)
    .set({
      title: title.trim(),
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
  const { conversationId } = await context.params;
  const auth = await requireConversationOwner(conversationId);
  if (!auth.ok) return auth.response;

  await db.delete(conversations).where(eq(conversations.id, auth.conversationId));
  return NextResponse.json({ ok: true });
}
