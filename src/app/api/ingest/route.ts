import { NextResponse } from "next/server";
import { runIngestion } from "@/lib/ingest";
import { requireRole } from "@/lib/auth/guards";
import { requireCsrf } from "@/lib/auth/csrf";

export async function POST(req: Request) {
  try {
    const csrfError = requireCsrf(req);
    if (csrfError) return csrfError;

    const auth = await requireRole("admin");
    if (!auth.ok) return auth.response;

    const { limit, productFilter } = await req.json().catch(() => ({}));
    
    // We run this as an async task, but in a real app, this should be a background job.
    // Next.js Route Handlers have a timeout, so we might not be able to crawl many pages here.
    // For the demo, we'll keep the limit low.
    
    const finalLimit = limit || Number(process.env.CRAWL_LIMIT) || 10;
    const finalProductFilter = productFilter || process.env.PRODUCT_FILTER || "unreal-engine";

    // Start ingestion in the "background" (not awaited to avoid timeout)
    runIngestion({
      limit: finalLimit,
      productFilter: finalProductFilter,
    });

    return NextResponse.json({ 
      message: "Ingestion started", 
      config: { limit: finalLimit, productFilter: finalProductFilter } 
    });
  } catch (error) {
    console.error("Ingestion error:", error);
    return NextResponse.json({ error: "Ingestion failed" }, { status: 500 });
  }
}
