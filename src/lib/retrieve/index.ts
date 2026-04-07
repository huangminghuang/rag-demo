import { db } from "@/lib/db";
import { chunks, documents } from "@/lib/db/schema";
import { generateEmbedding } from "@/lib/ingest/embeddings";
import { sql, eq, gt } from "drizzle-orm";
import {
  fuseHybridRetrievalResults,
  fuseRetrievalResults,
  type RetrievalBranchSource,
  type RetrievalBranchResult,
  type FusedRetrievalResult,
  type RetrievalMatchSource,
} from "./fusion";
import {
  resolveHybridRetrievalConfig,
  type HybridRetrievalConfig,
} from "./hybridRetrievalConfig";
import {
  rerankCandidates,
  type RerankingResult,
  type RerankingStatus,
} from "./reranker";
import {
  resolveRerankingConfig,
  type RerankingConfig,
} from "./rerankingConfig";
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
  matchedBy: RetrievalBranchSource[];
}

export interface RetrievalDebugBranchCounts {
  vectorOriginal: number;
  lexicalOriginal: number;
  vectorRewritten: number;
  lexicalRewritten: number;
}

export interface RetrievalDebugMetadata {
  originalQuery: string;
  rewrittenQuery: string | null;
  rewriteApplied: boolean;
  rewriteReason: QueryRewriteDecision["reason"];
  originalBranchCount: number;
  rewrittenBranchCount: number;
  branchCounts: RetrievalDebugBranchCounts;
  fusedCount: number;
  reranking?: RetrievalDebugRerankingMetadata;
}

export interface RetrievalDebugResponse {
  chunks: RetrievalDebugChunk[];
  debug: RetrievalDebugMetadata;
}

export interface RetrievalDebugRerankingMetadata {
  status: RerankingStatus;
  applied: boolean;
  inputCount: number;
  outputCount: number;
  beforeIds: string[];
  afterIds: string[];
  diagnostics: RerankingResult["diagnostics"];
  fallbackReason?: "timeout" | "model_failed" | "invalid_output";
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
  resolveRerankingConfig?: () => RerankingConfig;
  resolveRewriteConfig?: () => QueryRewriteConfig;
  rewriteQuery?: (
    query: string,
    config: QueryRewriteConfig,
  ) => Promise<QueryRewriteDecision>;
  rerankRetrievedCandidates?: (
    request: {
      originalQuery: string;
      rewrittenQuery: string | null;
      history?: string[];
      candidates: InternalRerankingCandidate[];
      limit: number;
    },
    config: RerankingConfig,
  ) => Promise<RerankingResult>;
}

interface RetrieveRelevantChunksOptions {
  limit?: number;
  threshold?: number;
  debug?: boolean;
  history?: string[];
}

const MIN_FUSION_BRANCH_LIMIT = 8;
type InternalRerankingCandidate = RetrievalDebugChunk & { chunkId: string };

function toPublicResult(result: StoredRetrievalResult): RetrievalResult {
  return {
    content: result.content,
    url: result.url,
    title: result.title,
    anchor: result.anchor,
    similarity: result.similarity,
  };
}

function toDebugChunk(
  result: StoredRetrievalResult,
  matchedBy: RetrievalBranchSource[],
): RetrievalDebugChunk {
  return {
    ...toPublicResult(result),
    matchedBy,
  };
}

function toLegacyDebugMatchedBy(matchedBy: RetrievalMatchSource): RetrievalBranchSource[] {
  if (matchedBy === "both") {
    return ["vector_original", "vector_rewritten"];
  }

  return matchedBy === "original" ? ["vector_original"] : ["vector_rewritten"];
}

function toDebugChunksFromLegacyResults(results: FusedRetrievalResult[]): RetrievalDebugChunk[] {
  return results.map((result) => toDebugChunk(result, toLegacyDebugMatchedBy(result.matchedBy)));
}

async function applyReranking(params: {
  query: string;
  rewrittenQuery: string | null;
  history?: string[];
  limit: number;
  candidates: InternalRerankingCandidate[];
  config: RerankingConfig;
  rerankRetrievedCandidates: NonNullable<RetrieveRelevantChunksDependencies["rerankRetrievedCandidates"]>;
}): Promise<{ chunks: RetrievalDebugChunk[]; reranking: RetrievalDebugRerankingMetadata }> {
  const rerankingResult = await params.rerankRetrievedCandidates(
    {
      originalQuery: params.query,
      rewrittenQuery: params.rewrittenQuery,
      history: params.history,
      candidates: params.candidates,
      limit: params.limit,
    },
    params.config,
  );

  return {
    chunks: rerankingResult.candidates.map((candidate) => ({
      content: candidate.content,
      url: candidate.url,
      title: candidate.title,
      anchor: candidate.anchor,
      similarity: candidate.similarity,
      matchedBy: [...candidate.matchedBy],
    })),
    reranking: toDebugRerankingMetadata(rerankingResult),
  };
}

function toFallbackReason(
  status: RerankingStatus,
): RetrievalDebugRerankingMetadata["fallbackReason"] {
  switch (status) {
    case "fallback_timeout":
      return "timeout";
    case "fallback_model_failed":
      return "model_failed";
    case "fallback_invalid_output":
      return "invalid_output";
    default:
      return undefined;
  }
}

function toDebugRerankingMetadata(result: RerankingResult): RetrievalDebugRerankingMetadata {
  const fallbackReason = toFallbackReason(result.status);

  return {
    status: result.status,
    applied: result.applied,
    inputCount: result.inputCount,
    outputCount: result.outputCount,
    beforeIds: [...result.beforeIds],
    afterIds: [...result.afterIds],
    diagnostics: result.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

function createSkippedRerankingMetadata(params: {
  status: "skipped_disabled" | "skipped_below_limit";
  candidateIds: string[];
  outputCount?: number;
}): RetrievalDebugRerankingMetadata {
  const outputCount = params.outputCount ?? params.candidateIds.length;

  return {
    status: params.status,
    applied: false,
    inputCount: params.candidateIds.length,
    outputCount,
    beforeIds: [...params.candidateIds],
    afterIds: params.candidateIds.slice(0, outputCount),
    diagnostics: [],
  };
}

function createBranchCounts(overrides: Partial<RetrievalDebugBranchCounts>): RetrievalDebugBranchCounts {
  return {
    vectorOriginal: 0,
    lexicalOriginal: 0,
    vectorRewritten: 0,
    lexicalRewritten: 0,
    ...overrides,
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
  const { limit = 5, threshold = 0.5, debug = false, history } = options;
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
  const resolveRerankingConfigFromEnv =
    dependencies.resolveRerankingConfig ?? (() => resolveRerankingConfig());
  const resolveRewriteConfig =
    dependencies.resolveRewriteConfig ?? (() => resolveQueryRewriteConfig());
  const hybridConfig = resolveHybridConfig();
  const rerankingConfig = resolveRerankingConfigFromEnv();
  const rewriteQuery = dependencies.rewriteQuery ?? rewriteQueryForRetrieval;
  const rerankRetrievedCandidates = dependencies.rerankRetrievedCandidates ?? rerankCandidates;
  const rewriteConfig = resolveRewriteConfig();
  const rewriteDecision = await rewriteQuery(query, rewriteConfig);

  if (!hybridConfig.enabled && !rewriteDecision.applied) {
    const originalOnlyResults = await searchByQuery(query, { limit, threshold });
    if (debug) {
      const reranking =
        rerankingConfig.enabled
          ? createSkippedRerankingMetadata({
              status: "skipped_below_limit",
              candidateIds: originalOnlyResults.map((result) => result.chunkId),
            })
          : createSkippedRerankingMetadata({
              status: "skipped_disabled",
              candidateIds: originalOnlyResults.map((result) => result.chunkId),
            });

      return {
        chunks: originalOnlyResults.map((result) => toDebugChunk(result, ["vector_original"])),
        debug: {
          originalQuery: rewriteDecision.originalQuery,
          rewrittenQuery: null,
          rewriteApplied: false,
          rewriteReason: rewriteDecision.reason,
          originalBranchCount: originalOnlyResults.length,
          rewrittenBranchCount: 0,
          branchCounts: createBranchCounts({
            vectorOriginal: originalOnlyResults.length,
          }),
          fusedCount: originalOnlyResults.length,
          reranking,
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

    const rerankingResult = await applyReranking({
      query: rewriteDecision.originalQuery,
      rewrittenQuery: rewriteDecision.rewrittenQuery,
      history,
      limit,
      candidates: fusedResults.map((result) => ({
        chunkId: result.chunkId,
        ...toDebugChunk(result, toLegacyDebugMatchedBy(result.matchedBy)),
      })),
      config: rerankingConfig,
      rerankRetrievedCandidates,
    });

    if (debug) {
      return {
        chunks: rerankingResult.chunks,
        debug: {
          originalQuery: rewriteDecision.originalQuery,
          rewrittenQuery: rewriteDecision.rewrittenQuery,
          rewriteApplied: true,
          rewriteReason: rewriteDecision.reason,
          originalBranchCount: originalResults.length,
          rewrittenBranchCount: rewrittenResults.length,
          branchCounts: createBranchCounts({
            vectorOriginal: originalResults.length,
            vectorRewritten: rewrittenResults.length,
          }),
          fusedCount: fusedResults.length,
          reranking: rerankingResult.reranking,
        },
      };
    }

    return rerankingResult.chunks.map(toPublicResult);
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

  const rerankingResult = await applyReranking({
    query: rewriteDecision.originalQuery,
    rewrittenQuery: rewriteDecision.rewrittenQuery,
    history,
    limit,
    candidates: hybridFusedResults.map((result) => ({
      chunkId: result.chunkId,
      ...toDebugChunk(result, result.matchedBy),
    })),
    config: rerankingConfig,
    rerankRetrievedCandidates,
  });

  if (debug) {
    return {
      chunks: rerankingResult.chunks,
      debug: {
        originalQuery: rewriteDecision.originalQuery,
        rewrittenQuery: rewriteDecision.rewrittenQuery,
        rewriteApplied: rewriteDecision.applied,
        rewriteReason: rewriteDecision.reason,
        originalBranchCount: originalVectorResults.length + originalLexicalResults.length,
        rewrittenBranchCount: rewrittenVectorResults.length + rewrittenLexicalResults.length,
        branchCounts: createBranchCounts({
          vectorOriginal: originalVectorResults.length,
          lexicalOriginal: originalLexicalResults.length,
          vectorRewritten: rewrittenVectorResults.length,
          lexicalRewritten: rewrittenLexicalResults.length,
        }),
        fusedCount: hybridFusedResults.length,
        reranking: rerankingResult.reranking,
      },
    };
  }

  return rerankingResult.chunks.map(toPublicResult);
}
