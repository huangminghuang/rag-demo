import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/guards";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(eq(conversations.userId, auth.user.id))
    .orderBy(desc(conversations.updatedAt));

  return NextResponse.json({ conversations: rows });
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { title }: { title?: string } = await req.json().catch(() => ({}));

  const [created] = await db
    .insert(conversations)
    .values({
      userId: auth.user.id,
      title: title?.trim() || "New Conversation",
      updatedAt: new Date(),
    })
    .returning({
      id: conversations.id,
      title: conversations.title,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    });

  return NextResponse.json({ conversation: created }, { status: 201 });
}
