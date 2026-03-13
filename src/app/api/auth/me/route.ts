import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    user: {
      id: auth.user.id,
      email: auth.user.email,
      name: auth.user.name,
      picture: auth.user.picture,
      role: auth.user.role,
    },
  });
}
