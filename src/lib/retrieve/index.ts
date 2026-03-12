import { db } from "@/lib/db";
import { chunks, documents } from "@/lib/db/schema";
import { generateEmbedding } from "@/lib/ingest/embeddings";
import { sql, eq, gt } from "drizzle-orm";

export interface RetrievalResult {
  content: string;
  url: string;
  title: string | null;
  anchor: string | null;
  similarity: number;
}

export async function retrieveRelevantChunks(
  query: string,
  options: { limit?: number; threshold?: number } = {}
): Promise<RetrievalResult[]> {
  const { limit = 5, threshold = 0.5 } = options;

  // 1. Generate embedding for the query
  const queryEmbedding = await generateEmbedding(query);

  // Embeddings use the same model and fixed dimensions for insert/query.

  // 2. Perform vector similarity search
  // Using cosine distance operator <=> in pgvector
  // Similarity = 1 - cosine_distance
  const similarity = sql<number>`1 - (${chunks.embedding} <=> ${JSON.stringify(queryEmbedding)}::halfvec)`;

  const results = await db
    .select({
      content: chunks.content,
      anchor: chunks.anchor,
      url: documents.url,
      title: documents.title,
      similarity,
    })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(gt(similarity, threshold))
    .orderBy(sql`${chunks.embedding} <=> ${JSON.stringify(queryEmbedding)}::halfvec`)
    .limit(limit);

  return results.map(r => ({
    ...r,
    // Construct the full URL with anchor if available
    url: r.anchor ? `${r.url}#${r.anchor}` : r.url
  }));
}
