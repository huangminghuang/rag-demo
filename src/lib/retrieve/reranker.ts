import { z } from "zod";
import type { RetrievalBranchSource } from "./fusion";
import type { RerankingConfig } from "./rerankingConfig";

export interface RerankingCandidate {
  chunkId: string;
  content: string;
  url: string;
  title: string | null;
  anchor: string | null;
  similarity: number;
  matchedBy: RetrievalBranchSource[];
}

export interface RerankingRequest {
  originalQuery: string;
  rewrittenQuery: string | null;
  history?: string[];
  candidates: RerankingCandidate[];
  limit: number;
}

export interface RerankingCandidateDiagnostic {
  chunkId: string;
  score: number | null;
  reason: string | null;
}

export type RerankingStatus =
  | "skipped_disabled"
  | "skipped_below_limit"
  | "applied"
  | "fallback_timeout"
  | "fallback_model_failed"
  | "fallback_invalid_output";

export interface RerankingResult {
  applied: boolean;
  status: RerankingStatus;
  inputCount: number;
  outputCount: number;
  beforeIds: string[];
  afterIds: string[];
  diagnostics: RerankingCandidateDiagnostic[];
  candidates: RerankingCandidate[];
}

interface RerankCandidatesDependencies {
  rerankModel?: (prompt: string) => Promise<string>;
}

const DEFAULT_RERANKING_MODEL_NAME = "gemini-2.5-flash";
const DEFAULT_RERANKING_API_VERSION = "v1beta";
const MAX_CANDIDATE_CONTENT_LENGTH = 1200;

const rerankerResponseSchema = z.object({
  rankedIds: z.array(z.string()),
  diagnostics: z
    .array(
      z.object({
        chunkId: z.string(),
        score: z.number().nullable().optional(),
        reason: z.string().nullable().optional(),
      }),
    )
    .optional(),
});

class RerankerTimeoutError extends Error {
  constructor() {
    super("Reranker timed out");
    this.name = "RerankerTimeoutError";
  }
}

class RerankerInvalidOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RerankerInvalidOutputError";
  }
}

function createPassThroughResult(params: {
  request: RerankingRequest;
  candidates: RerankingCandidate[];
  status: Exclude<RerankingStatus, "applied">;
}): RerankingResult {
  const finalCandidates = params.candidates.slice(0, params.request.limit);
  const beforeIds = params.candidates.map((candidate) => candidate.chunkId);
  const afterIds = finalCandidates.map((candidate) => candidate.chunkId);

  return {
    applied: false,
    status: params.status,
    inputCount: params.candidates.length,
    outputCount: finalCandidates.length,
    beforeIds,
    afterIds,
    diagnostics: [],
    candidates: finalCandidates,
  };
}

// Keep reranker candidate payloads bounded so the model call remains stable and cheap.
function truncateCandidateContent(content: string): string {
  if (content.length <= MAX_CANDIDATE_CONTENT_LENGTH) {
    return content;
  }

  return `${content.slice(0, MAX_CANDIDATE_CONTENT_LENGTH).trimEnd()}...`;
}

function buildRerankingPrompt(request: RerankingRequest, candidates: RerankingCandidate[]): string {
  const historyBlock =
    request.history && request.history.length > 0
      ? [
          "Conversation history:",
          ...request.history.map((entry, index) => `History ${index + 1}: ${entry}`),
          "",
        ].join("\n")
      : "";

  const candidateBlock = candidates
    .map((candidate, index) =>
      [
        `Candidate ${index + 1}`,
        `id: ${candidate.chunkId}`,
        `title: ${candidate.title ?? "(none)"}`,
        `url: ${candidate.url}`,
        `anchor: ${candidate.anchor ?? "(none)"}`,
        `matchedBy: ${candidate.matchedBy.join(", ") || "(none)"}`,
        `content: ${truncateCandidateContent(candidate.content)}`,
      ].join("\n"),
    )
    .join("\n\n");

  return [
    "You are ranking retrieved Vite documentation chunks for answer usefulness.",
    "Rank the candidates for how useful they are for answering the user's question.",
    "Preserve exact technical matches when they are directly relevant, including identifiers, config keys, file names, commands, paths, and anchors.",
    "Prefer distinct useful evidence over near-duplicate chunks when multiple candidates repeat the same point.",
    "Use the original user question as the primary intent signal.",
    "Use the rewritten query only as supporting retrieval context when present.",
    "Return JSON only.",
    "The JSON must have a rankedIds array containing each provided candidate id exactly once.",
    "You may include diagnostics with chunkId, optional numeric score, and optional short reason.",
    "",
    "Original user question:",
    request.originalQuery,
    "",
    request.rewrittenQuery
      ? `Rewritten retrieval query:\n${request.rewrittenQuery}\n`
      : "Rewritten retrieval query:\n(none)\n",
    historyBlock,
    "Candidates:",
    candidateBlock,
    "",
    'Output format: {"rankedIds":["candidate-id"],"diagnostics":[{"chunkId":"candidate-id","score":0.0,"reason":"short reason"}]}',
  ]
    .filter(Boolean)
    .join("\n");
}

function extractJsonObject(rawResponse: string): string {
  const fencedJsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedJsonMatch) {
    return fencedJsonMatch[1].trim();
  }

  const firstBrace = rawResponse.indexOf("{");
  const lastBrace = rawResponse.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new RerankerInvalidOutputError("Reranker response did not contain a JSON object");
  }

  return rawResponse.slice(firstBrace, lastBrace + 1);
}

function parseRerankerResponse(rawResponse: string): z.infer<typeof rerankerResponseSchema> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(extractJsonObject(rawResponse));
  } catch (error) {
    if (error instanceof RerankerInvalidOutputError) {
      throw error;
    }

    throw new RerankerInvalidOutputError("Reranker response did not contain valid JSON");
  }

  try {
    return rerankerResponseSchema.parse(parsed);
  } catch {
    throw new RerankerInvalidOutputError("Reranker response did not match the expected schema");
  }
}

function hasExactCandidatePermutation(
  rankedIds: string[],
  candidateIds: string[],
): boolean {
  if (rankedIds.length !== candidateIds.length) {
    return false;
  }

  const expectedIds = new Set(candidateIds);
  const seen = new Set<string>();

  for (const id of rankedIds) {
    if (!expectedIds.has(id) || seen.has(id)) {
      return false;
    }

    seen.add(id);
  }

  return seen.size === expectedIds.size;
}

function toDiagnostics(
  rankedIds: string[],
  diagnostics: z.infer<typeof rerankerResponseSchema>["diagnostics"],
): RerankingCandidateDiagnostic[] {
  const diagnosticsById = new Map(
    (diagnostics ?? []).map((entry) => [
      entry.chunkId,
      {
        chunkId: entry.chunkId,
        score: entry.score ?? null,
        reason: entry.reason ?? null,
      },
    ]),
  );

  return rankedIds.map((chunkId) => ({
    chunkId,
    score: diagnosticsById.get(chunkId)?.score ?? null,
    reason: diagnosticsById.get(chunkId)?.reason ?? null,
  }));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => reject(new RerankerTimeoutError()), timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeoutHandle);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      });
  });
}

function logRerankingDecision(config: RerankingConfig, result: RerankingResult): void {
  if (!config.debug) {
    return;
  }

  console.info("[reranking-debug]", {
    status: result.status,
    inputCount: result.inputCount,
    outputCount: result.outputCount,
    beforeIds: result.beforeIds,
    afterIds: result.afterIds,
    diagnostics: result.diagnostics,
  });
}

async function rerankWithGemini(prompt: string): Promise<string> {
  const { getRerankingGenAI } = await import("@/lib/gemini");
  const modelName = process.env.RERANKING_MODEL_NAME || process.env.QUERY_MODEL_NAME || DEFAULT_RERANKING_MODEL_NAME;
  const apiVersion =
    process.env.RERANKING_MODEL_API_VERSION ||
    process.env.QUERY_MODEL_API_VERSION ||
    DEFAULT_RERANKING_API_VERSION;
  const model = getRerankingGenAI().getGenerativeModel(
    { model: modelName },
    { apiVersion },
  );
  const result = await model.generateContent(prompt);
  return result.response.text();
}

// Rerank fused retrieval candidates through one bounded model call and fail open on any contract violation.
export async function rerankCandidates(
  request: RerankingRequest,
  config: RerankingConfig,
  dependencies: RerankCandidatesDependencies = {},
): Promise<RerankingResult> {
  if (!config.enabled) {
    const result = createPassThroughResult({
      request,
      candidates: request.candidates,
      status: "skipped_disabled",
    });
    logRerankingDecision(config, result);
    return result;
  }

  const candidateBudget = Math.max(request.limit, config.candidateCount);
  const boundedCandidates = request.candidates.slice(0, candidateBudget);

  if (boundedCandidates.length <= request.limit) {
    const result = createPassThroughResult({
      request,
      candidates: boundedCandidates,
      status: "skipped_below_limit",
    });
    logRerankingDecision(config, result);
    return result;
  }

  const rerankModel = dependencies.rerankModel ?? rerankWithGemini;
  const prompt = buildRerankingPrompt(request, boundedCandidates);
  const beforeIds = boundedCandidates.map((candidate) => candidate.chunkId);

  try {
    const rawResponse = await withTimeout(rerankModel(prompt), config.timeoutMs);
    const parsed = parseRerankerResponse(rawResponse);

    if (!hasExactCandidatePermutation(parsed.rankedIds, beforeIds)) {
      throw new RerankerInvalidOutputError("Reranker returned an invalid candidate permutation");
    }

    const candidatesById = new Map(
      boundedCandidates.map((candidate) => [candidate.chunkId, candidate]),
    );
    const rerankedCandidates = parsed.rankedIds
      .map((chunkId) => candidatesById.get(chunkId))
      .filter((candidate): candidate is RerankingCandidate => Boolean(candidate))
      .slice(0, request.limit);
    const afterIds = rerankedCandidates.map((candidate) => candidate.chunkId);
    const result: RerankingResult = {
      applied: true,
      status: "applied",
      inputCount: boundedCandidates.length,
      outputCount: rerankedCandidates.length,
      beforeIds,
      afterIds,
      diagnostics: toDiagnostics(parsed.rankedIds, parsed.diagnostics).filter((entry) =>
        afterIds.includes(entry.chunkId),
      ),
      candidates: rerankedCandidates,
    };
    logRerankingDecision(config, result);
    return result;
  } catch (error) {
    const result = createPassThroughResult({
      request,
      candidates: boundedCandidates,
      status:
        error instanceof RerankerTimeoutError
          ? "fallback_timeout"
          : error instanceof RerankerInvalidOutputError
            ? "fallback_invalid_output"
            : "fallback_model_failed",
    });
    logRerankingDecision(config, result);
    return result;
  }
}
