import { NextResponse } from "next/server";
import { runIngestion } from "@/lib/ingest";
import { listChunkDebugRecords, resolveIngestionAdminOptions } from "@/lib/ingest/admin";
import { requireRole } from "@/lib/auth/guards";
import { requireCsrf } from "@/lib/auth/csrf";

export async function POST(req: Request) {
  try {
    const csrfError = requireCsrf(req);
    if (csrfError) return csrfError;

    const auth = await requireRole("admin");
    if (!auth.ok) return auth.response;

    const payload = await req.json().catch(() => ({}));
    
    // We run this as an async task, but in a real app, this should be a background job.
    // Next.js Route Handlers have a timeout, so we might not be able to crawl many pages here.
    // For the demo, we'll keep the limit low.

    const options = resolveIngestionAdminOptions(payload);

    // Start ingestion in the "background" (not awaited to avoid timeout)
    runIngestion({
      limit: options.limit,
      productFilter: options.productFilter,
      forceReindex: options.forceReindex,
    });

    return NextResponse.json({ 
      message: "Ingestion started", 
      config: options,
    });
  } catch (error) {
    console.error("Ingestion error:", error);
    return NextResponse.json({ error: "Ingestion failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const auth = await requireRole("admin");
    if (!auth.ok) return auth.response;

    const url = new URL(req.url);
    const records = await listChunkDebugRecords({
      limit: url.searchParams.get("limit") || undefined,
      url: url.searchParams.get("url") || undefined,
    });

    return NextResponse.json({ chunks: records });
  } catch (error) {
    console.error("Ingestion debug error:", error);
    return NextResponse.json({ error: "Unable to load ingestion debug records" }, { status: 500 });
  }
}
