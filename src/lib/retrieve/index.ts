import { db } from "@/lib/db";
import { chunks, documents } from "@/lib/db/schema";
import { generateEmbedding } from "@/lib/ingest/embeddings";
import { sql, eq, gt } from "drizzle-orm";
import { fuseRetrievalResults, type RetrievalBranchResult } from "./fusion";
import { resolveQueryRewriteConfig, type QueryRewriteConfig } from "./queryRewriteConfig";
import {
  rewriteQueryForRetrieval,
  type QueryRewriteDecision,
} from "./queryRewrite";

export interface RetrievalResult {
  content: string;
  url: string;
  title: string | null;
  anchor: string | null;
  similarity: number;
}

type StoredRetrievalResult = RetrievalBranchResult;

interface RetrieveRelevantChunksDependencies {
  generateQueryEmbedding?: typeof generateEmbedding;
  searchByQuery?: (
    query: string,
    options: { limit: number; threshold: number },
  ) => Promise<StoredRetrievalResult[]>;
  resolveRewriteConfig?: () => QueryRewriteConfig;
  rewriteQuery?: (
    query: string,
    config: QueryRewriteConfig,
  ) => Promise<QueryRewriteDecision>;
}

const MIN_FUSION_BRANCH_LIMIT = 8;

function toPublicResult(result: StoredRetrievalResult): RetrievalResult {
  return {
    content: result.content,
    url: result.url,
    title: result.title,
    anchor: result.anchor,
    similarity: result.similarity,
  };
}

// Derive the per-branch fetch size used before fusion so each branch can contribute unique hits.
function getPreFusionFetchLimit(limit: number): number {
  return Math.max(limit, MIN_FUSION_BRANCH_LIMIT);
}

// Run one vector search against stored chunk embeddings and keep stable chunk identity for fusion.
async function searchChunksByQuery(
  query: string,
  options: { limit: number; threshold: number },
  dependencies: Pick<RetrieveRelevantChunksDependencies, "generateQueryEmbedding"> = {},
): Promise<StoredRetrievalResult[]> {
  const generateQueryEmbedding = dependencies.generateQueryEmbedding ?? generateEmbedding;
  const queryEmbedding = await generateQueryEmbedding(query);

  // Embeddings use the same model and fixed dimensions for insert/query.
  // Using cosine distance operator <=> in pgvector.
  const similarity = sql<number>`1 - (${chunks.embedding} <=> ${JSON.stringify(queryEmbedding)}::halfvec)`;

  const results = await db
    .select({
      chunkId: chunks.id,
      content: chunks.content,
      anchor: chunks.anchor,
      url: documents.url,
      title: documents.title,
      similarity,
    })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(gt(similarity, options.threshold))
    .orderBy(sql`${chunks.embedding} <=> ${JSON.stringify(queryEmbedding)}::halfvec`)
    .limit(options.limit);

  return results.map((result) => ({
    ...result,
    url: result.anchor ? `${result.url}#${result.anchor}` : result.url,
  }));
}

export async function retrieveRelevantChunks(
  query: string,
  options: { limit?: number; threshold?: number } = {},
  dependencies: RetrieveRelevantChunksDependencies = {},
): Promise<RetrievalResult[]> {
  const { limit = 5, threshold = 0.5 } = options;
  const searchByQuery =
    dependencies.searchByQuery ??
    ((searchQuery, searchOptions) =>
      searchChunksByQuery(searchQuery, searchOptions, {
        generateQueryEmbedding: dependencies.generateQueryEmbedding,
      }));
  const resolveRewriteConfig =
    dependencies.resolveRewriteConfig ?? (() => resolveQueryRewriteConfig());
  const rewriteQuery = dependencies.rewriteQuery ?? rewriteQueryForRetrieval;
  const rewriteConfig = resolveRewriteConfig();
  const rewriteDecision = await rewriteQuery(query, rewriteConfig);

  if (!rewriteDecision.applied) {
    const originalOnlyResults = await searchByQuery(query, { limit, threshold });
    return originalOnlyResults.map(toPublicResult);
  }

  const preFusionFetchLimit = getPreFusionFetchLimit(limit);
  const [originalResults, rewrittenResults] = await Promise.all([
    searchByQuery(rewriteDecision.originalQuery, { limit: preFusionFetchLimit, threshold }),
    searchByQuery(rewriteDecision.rewrittenQuery, { limit: preFusionFetchLimit, threshold }),
  ]);

  const fusedResults = fuseRetrievalResults({
    originalResults,
    rewrittenResults,
    limit,
  });

  return fusedResults.map(toPublicResult);
}
