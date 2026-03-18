import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conversationMessages, conversations } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
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
  const csrfError = requireCsrf(req);
  if (csrfError) return csrfError;

  const { conversationId } = await context.params;
  if (!isUuid(conversationId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireConversationOwner(conversationId);
  if (!auth.ok) return auth.response;

  const { role, content }: { role?: "user" | "assistant"; content?: string } = await req.json().catch(() => ({}));
  if (!role || (role !== "user" && role !== "assistant")) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }
  if (!content || !content.trim()) {
    return NextResponse.json({ error: "Content is required" }, { status: 400 });
  }
  const normalizedContent = content.trim();
  if (normalizedContent.length > 8000) {
    return NextResponse.json({ error: "Content is too long (max 8000 chars)" }, { status: 400 });
  }

  const [created] = await db
    .insert(conversationMessages)
    .values({
      conversationId: auth.conversationId,
      userId: auth.user.id,
      role,
      content: normalizedContent,
    })
    .returning({
      id: conversationMessages.id,
      role: conversationMessages.role,
      content: conversationMessages.content,
      createdAt: conversationMessages.createdAt,
    });

  const [currentConversation] = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(eq(conversations.id, auth.conversationId))
    .limit(1);

  const shouldPromoteTitle =
    role === "user" &&
    (!currentConversation?.title || currentConversation.title.trim() === "New Conversation");
  const nextTitle = shouldPromoteTitle ? normalizedContent.slice(0, 160) : currentConversation?.title ?? null;

  const [updatedConversation] = await db
    .update(conversations)
    .set({
      title: nextTitle,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, auth.conversationId))
    .returning({
      id: conversations.id,
      title: conversations.title,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    });

  return NextResponse.json({ message: created, conversation: updatedConversation }, { status: 201 });
}
