import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chunks, documents } from "@/lib/db/schema";

export interface IngestionAdminOptions {
  limit: number;
  productFilter: string;
  forceReindex: boolean;
}

export interface ChunkDebugRecord {
  url: string;
  title: string | null;
  anchor: string | null;
  chunkIndex: number;
  contentKind?: string;
  enrichmentStatus?: string;
  embeddingInputVersion?: string;
  embeddingInputPreview?: string;
}

function parsePositiveInteger(rawValue: unknown, fallback: number): number {
  const parsed = typeof rawValue === "number"
    ? rawValue
    : typeof rawValue === "string"
      ? Number.parseInt(rawValue, 10)
      : Number.NaN;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(rawValue: unknown): boolean {
  return rawValue === true || rawValue === "true";
}

// Resolve admin-triggered ingestion options from request payload and env defaults.
export function resolveIngestionAdminOptions(
  body: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): IngestionAdminOptions {
  return {
    limit: parsePositiveInteger(body.limit, Number(env.CRAWL_LIMIT) || 10),
    productFilter:
      typeof body.productFilter === "string" && body.productFilter.trim().length > 0
        ? body.productFilter.trim()
        : env.PRODUCT_FILTER || "unreal-engine",
    forceReindex: parseBoolean(body.forceReindex),
  };
}

// Query recent chunk-level enrichment/debug metadata for internal admin inspection.
export async function listChunkDebugRecords(options: {
  limit?: number;
  url?: string;
} = {}): Promise<ChunkDebugRecord[]> {
  const limit = parsePositiveInteger(options.limit, 20);
  const rows = await db
    .select({
      url: documents.url,
      title: documents.title,
      anchor: chunks.anchor,
      chunkIndex: chunks.chunkIndex,
      metadata: chunks.metadata,
    })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(options.url ? and(eq(documents.url, options.url)) : undefined)
    .orderBy(desc(documents.lastCrawledAt), chunks.chunkIndex)
    .limit(limit);

  return rows.map((row) => {
    const metadata = (row.metadata || {}) as Record<string, unknown>;
    const enrichment = (metadata.enrichment || {}) as Record<string, unknown>;

    return {
      url: row.url,
      title: row.title,
      anchor: row.anchor,
      chunkIndex: row.chunkIndex,
      contentKind: typeof metadata.content_kind === "string" ? metadata.content_kind : undefined,
      enrichmentStatus:
        typeof enrichment.status === "string" ? enrichment.status : undefined,
      embeddingInputVersion:
        typeof metadata.embedding_input_version === "string"
          ? metadata.embedding_input_version
          : undefined,
      embeddingInputPreview:
        typeof metadata.embedding_input_preview === "string"
          ? metadata.embedding_input_preview
          : undefined,
    };
  });
}
