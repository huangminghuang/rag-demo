import { db } from "@/lib/db";
import { chunks, documents } from "@/lib/db/schema";
import { generateEmbedding } from "@/lib/ingest/embeddings";
import { sql, eq, gt } from "drizzle-orm";
import {
  fuseHybridRetrievalResults,
  fuseRetrievalResults,
  type RetrievalBranchSource,
  type RetrievalBranchResult,
  type RetrievalMatchSource,
} from "./fusion";
import {
  resolveHybridRetrievalConfig,
  type HybridRetrievalConfig,
} from "./hybridRetrievalConfig";
import { searchChunksLexically } from "./lexicalSearch";
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

export interface RetrievalDebugChunk extends RetrievalResult {
  matchedBy: RetrievalMatchSource;
}

export interface RetrievalDebugMetadata {
  originalQuery: string;
  rewrittenQuery: string | null;
  rewriteApplied: boolean;
  rewriteReason: QueryRewriteDecision["reason"];
  originalBranchCount: number;
  rewrittenBranchCount: number;
  fusedCount: number;
}

export interface RetrievalDebugResponse {
  chunks: RetrievalDebugChunk[];
  debug: RetrievalDebugMetadata;
}

type StoredRetrievalResult = RetrievalBranchResult;

interface RetrieveRelevantChunksDependencies {
  generateQueryEmbedding?: typeof generateEmbedding;
  searchByQuery?: (
    query: string,
    options: { limit: number; threshold: number },
  ) => Promise<StoredRetrievalResult[]>;
  searchLexically?: (
    query: string,
    options: { limit: number; trigramThreshold: number },
  ) => Promise<StoredRetrievalResult[]>;
  resolveHybridConfig?: () => HybridRetrievalConfig;
  resolveRewriteConfig?: () => QueryRewriteConfig;
  rewriteQuery?: (
    query: string,
    config: QueryRewriteConfig,
  ) => Promise<QueryRewriteDecision>;
}

interface RetrieveRelevantChunksOptions {
  limit?: number;
  threshold?: number;
  debug?: boolean;
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

// Collapse branch-level hybrid provenance back into the current debug surface until hybrid debug expands in phase 1.
function toLegacyMatchSource(matchedBy: RetrievalBranchSource[]): RetrievalMatchSource {
  const hasOriginal = matchedBy.some(
    (source) => source === "vector_original" || source === "lexical_original",
  );
  const hasRewritten = matchedBy.some(
    (source) => source === "vector_rewritten" || source === "lexical_rewritten",
  );

  if (hasOriginal && hasRewritten) {
    return "both";
  }

  return hasOriginal ? "original" : "rewritten";
}

function toDebugChunk(
  result: StoredRetrievalResult,
  matchedBy: RetrievalMatchSource,
): RetrievalDebugChunk {
  return {
    ...toPublicResult(result),
    matchedBy,
  };
}

// Derive the per-branch fetch size used before fusion so each branch can contribute unique hits.
function getPreFusionFetchLimit(limit: number): number {
  return Math.max(limit, MIN_FUSION_BRANCH_LIMIT);
}

// Over-fetch more aggressively in hybrid mode so vector and lexical branches can both contribute candidates.
function getHybridPreFusionFetchLimit(limit: number, preFusionLimit: number): number {
  return Math.max(limit * 3, preFusionLimit);
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
  options: RetrieveRelevantChunksOptions & { debug: true },
  dependencies?: RetrieveRelevantChunksDependencies,
): Promise<RetrievalDebugResponse>;
export async function retrieveRelevantChunks(
  query: string,
  options?: RetrieveRelevantChunksOptions,
  dependencies?: RetrieveRelevantChunksDependencies,
): Promise<RetrievalResult[]>;
export async function retrieveRelevantChunks(
  query: string,
  options: RetrieveRelevantChunksOptions = {},
  dependencies: RetrieveRelevantChunksDependencies = {},
): Promise<RetrievalResult[] | RetrievalDebugResponse> {
  const { limit = 5, threshold = 0.5, debug = false } = options;
  const searchByQuery =
    dependencies.searchByQuery ??
    ((searchQuery, searchOptions) =>
      searchChunksByQuery(searchQuery, searchOptions, {
        generateQueryEmbedding: dependencies.generateQueryEmbedding,
      }));
  const searchLexically =
    dependencies.searchLexically ??
    ((searchQuery, searchOptions) => searchChunksLexically(searchQuery, searchOptions));
  const resolveHybridConfig =
    dependencies.resolveHybridConfig ?? (() => resolveHybridRetrievalConfig());
  const resolveRewriteConfig =
    dependencies.resolveRewriteConfig ?? (() => resolveQueryRewriteConfig());
  const hybridConfig = resolveHybridConfig();
  const rewriteQuery = dependencies.rewriteQuery ?? rewriteQueryForRetrieval;
  const rewriteConfig = resolveRewriteConfig();
  const rewriteDecision = await rewriteQuery(query, rewriteConfig);

  if (!hybridConfig.enabled && !rewriteDecision.applied) {
    const originalOnlyResults = await searchByQuery(query, { limit, threshold });
    if (debug) {
      return {
        chunks: originalOnlyResults.map((result) => toDebugChunk(result, "original")),
        debug: {
          originalQuery: rewriteDecision.originalQuery,
          rewrittenQuery: null,
          rewriteApplied: false,
          rewriteReason: rewriteDecision.reason,
          originalBranchCount: originalOnlyResults.length,
          rewrittenBranchCount: 0,
          fusedCount: originalOnlyResults.length,
        },
      };
    }

    return originalOnlyResults.map(toPublicResult);
  }

  if (!hybridConfig.enabled) {
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

    if (debug) {
      return {
        chunks: fusedResults.map((result) => toDebugChunk(result, result.matchedBy)),
        debug: {
          originalQuery: rewriteDecision.originalQuery,
          rewrittenQuery: rewriteDecision.rewrittenQuery,
          rewriteApplied: true,
          rewriteReason: rewriteDecision.reason,
          originalBranchCount: originalResults.length,
          rewrittenBranchCount: rewrittenResults.length,
          fusedCount: fusedResults.length,
        },
      };
    }

    return fusedResults.map(toPublicResult);
  }

  const preFusionFetchLimit = getHybridPreFusionFetchLimit(limit, hybridConfig.preFusionLimit);
  const originalVectorPromise = searchByQuery(rewriteDecision.originalQuery, {
    limit: preFusionFetchLimit,
    threshold,
  });
  const originalLexicalPromise = searchLexically(rewriteDecision.originalQuery, {
    limit: preFusionFetchLimit,
    trigramThreshold: hybridConfig.trigramThreshold,
  });

  const [originalVectorResults, originalLexicalResults, rewrittenVectorResults, rewrittenLexicalResults] =
    rewriteDecision.applied
      ? await Promise.all([
          originalVectorPromise,
          originalLexicalPromise,
          searchByQuery(rewriteDecision.rewrittenQuery, {
            limit: preFusionFetchLimit,
            threshold,
          }),
          searchLexically(rewriteDecision.rewrittenQuery, {
            limit: preFusionFetchLimit,
            trigramThreshold: hybridConfig.trigramThreshold,
          }),
        ])
      : await Promise.all([
          originalVectorPromise,
          originalLexicalPromise,
          Promise.resolve([] as StoredRetrievalResult[]),
          Promise.resolve([] as StoredRetrievalResult[]),
        ]);

  const hybridFusedResults = fuseHybridRetrievalResults({
    branches: [
      { source: "vector_original", results: originalVectorResults },
      { source: "lexical_original", results: originalLexicalResults },
      { source: "vector_rewritten", results: rewrittenVectorResults },
      { source: "lexical_rewritten", results: rewrittenLexicalResults },
    ],
    limit,
  });

  if (debug) {
    return {
      chunks: hybridFusedResults.map((result) => toDebugChunk(result, toLegacyMatchSource(result.matchedBy))),
      debug: {
        originalQuery: rewriteDecision.originalQuery,
        rewrittenQuery: rewriteDecision.rewrittenQuery,
        rewriteApplied: rewriteDecision.applied,
        rewriteReason: rewriteDecision.reason,
        originalBranchCount: originalVectorResults.length + originalLexicalResults.length,
        rewrittenBranchCount: rewrittenVectorResults.length + rewrittenLexicalResults.length,
        fusedCount: hybridFusedResults.length,
      },
    };
  }

  return hybridFusedResults.map(toPublicResult);
}
