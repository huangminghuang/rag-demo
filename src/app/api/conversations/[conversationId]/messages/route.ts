import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conversationMessages, conversations } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireConversationOwner } from "@/lib/auth/guards";

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

export async function GET(_req: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  const auth = await requireConversationOwner(conversationId);
  if (!auth.ok) return auth.response;

  const rows = await db
    .select({
      id: conversationMessages.id,
      role: conversationMessages.role,
      content: conversationMessages.content,
      createdAt: conversationMessages.createdAt,
    })
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, auth.conversationId))
    .orderBy(asc(conversationMessages.createdAt));

  return NextResponse.json({ messages: rows });
}

export async function POST(req: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  const auth = await requireConversationOwner(conversationId);
  if (!auth.ok) return auth.response;

  const { role, content }: { role?: "user" | "assistant"; content?: string } = await req.json().catch(() => ({}));
  if (!role || (role !== "user" && role !== "assistant")) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }
  if (!content || !content.trim()) {
    return NextResponse.json({ error: "Content is required" }, { status: 400 });
  }

  const [created] = await db
    .insert(conversationMessages)
    .values({
      conversationId: auth.conversationId,
      userId: auth.user.id,
      role,
      content: content.trim(),
    })
    .returning({
      id: conversationMessages.id,
      role: conversationMessages.role,
      content: conversationMessages.content,
      createdAt: conversationMessages.createdAt,
    });

  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, auth.conversationId));

  return NextResponse.json({ message: created }, { status: 201 });
}
