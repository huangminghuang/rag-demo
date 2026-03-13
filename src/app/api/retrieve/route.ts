import { NextResponse } from "next/server";
import { retrieveRelevantChunks } from "@/lib/retrieve";
import { isEmbeddingQuotaExceededError } from "@/lib/quota/embeddingQuota";
import { resolveRetrieveThreshold } from "@/lib/retrieve/config";
import { requireUser } from "@/lib/auth/guards";
import { requireCsrf } from "@/lib/auth/csrf";

export async function POST(req: Request) {
  try {
    const csrfError = requireCsrf(req);
    if (csrfError) return csrfError;

    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const { query, limit, threshold } = await req.json();

    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    const chunks = await retrieveRelevantChunks(query, {
      limit: typeof limit === "number" && limit > 0 ? limit : 5,
      threshold: resolveRetrieveThreshold(threshold),
    });

    return NextResponse.json({ chunks });
  } catch (error) {
    if (isEmbeddingQuotaExceededError(error)) {
      const response = NextResponse.json(
        {
          error: error.message,
          reason: error.reason,
          limits: error.limits,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        { status: 429 }
      );
      response.headers.set("Retry-After", String(error.retryAfterSeconds));
      return response;
    }

    console.error("Retrieval error:", error);
    return NextResponse.json({ error: "Retrieval failed" }, { status: 500 });
  }
}
