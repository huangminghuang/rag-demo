import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/guards";
import { requireCsrf } from "@/lib/auth/csrf";

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
  const csrfError = requireCsrf(req);
  if (csrfError) return csrfError;

  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { title }: { title?: string } = await req.json().catch(() => ({}));
  const normalizedTitle = title?.trim() || "New Conversation";
  if (normalizedTitle.length > 160) {
    return NextResponse.json({ error: "Title is too long (max 160 chars)" }, { status: 400 });
  }

  const [created] = await db
    .insert(conversations)
    .values({
      userId: auth.user.id,
      title: normalizedTitle,
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
