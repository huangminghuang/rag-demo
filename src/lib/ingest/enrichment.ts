import { planChunkEnrichment, type ChunkEnrichmentDecision, type EnrichmentConfig, type PlannedChunkEnrichment } from "./enrichmentConfig";
import type { ChunkEnrichmentMetadata, StructureAwareChunk } from "./structureTypes";

interface RawChunkEnrichment {
  summary?: string;
  keywords?: string[];
  hypothetical_questions?: string[];
  entities?: string[];
  topics?: string[];
  table_summary?: string;
  code_summary?: string;
  api_symbols?: string[];
}

type EnrichChunkFn = (
  chunk: StructureAwareChunk,
  config: EnrichmentConfig,
) => Promise<RawChunkEnrichment>;

function applyEnrichmentMetadata(
  chunk: StructureAwareChunk,
  enrichment: ChunkEnrichmentMetadata,
): StructureAwareChunk {
  return {
    ...chunk,
    metadata: {
      ...chunk.metadata,
      enrichment,
    },
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeStringArray(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }

  const normalized = values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);

  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
}

// Validate successful chunk enrichment output before it is persisted into chunk metadata.
export function validateEnrichmentOutput(
  chunk: Pick<StructureAwareChunk, "metadata">,
  input: RawChunkEnrichment,
): ChunkEnrichmentMetadata {
  const summary = isNonEmptyString(input.summary) ? input.summary.trim() : undefined;
  const keywords = normalizeStringArray(input.keywords);
  const hypotheticalQuestions = normalizeStringArray(input.hypothetical_questions);
  const entities = normalizeStringArray(input.entities);
  const topics = normalizeStringArray(input.topics);
  const tableSummary = isNonEmptyString(input.table_summary) ? input.table_summary.trim() : undefined;
  const codeSummary = isNonEmptyString(input.code_summary) ? input.code_summary.trim() : undefined;
  const apiSymbols = normalizeStringArray(input.api_symbols);

  if (!summary) {
    throw new Error("invalid_enrichment_output");
  }
  if (!keywords || keywords.length === 0) {
    throw new Error("invalid_enrichment_output");
  }
  if (!hypotheticalQuestions || hypotheticalQuestions.length === 0) {
    throw new Error("invalid_enrichment_output");
  }
  if (chunk.metadata.content_kind === "table" && !tableSummary) {
    throw new Error("invalid_enrichment_output");
  }
  if (chunk.metadata.content_kind === "code" && !codeSummary && (!apiSymbols || apiSymbols.length === 0)) {
    throw new Error("invalid_enrichment_output");
  }

  return {
    version: "meta-v1",
    status: "success",
    summary,
    keywords,
    hypothetical_questions: hypotheticalQuestions,
    entities,
    topics,
    table_summary: tableSummary,
    code_summary: codeSummary,
    api_symbols: apiSymbols,
  };
}

function getSkippedEnrichment(decision: ChunkEnrichmentDecision): ChunkEnrichmentMetadata {
  return {
    version: "meta-v1",
    status: "skipped_by_policy",
    skip_reason: decision.reason,
  };
}

function getFailedEnrichment(reason: string): ChunkEnrichmentMetadata {
  return {
    version: "meta-v1",
    status: "failed",
    failure_reason: reason,
  };
}

function getConfiguredConcurrency(config: EnrichmentConfig): number {
  return config.modelProfile.mode === "bounded_parallel"
    ? config.modelProfile.maxConcurrency
    : 1;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("enrichment_timeout"));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function enrichOnePlannedChunk(
  planned: PlannedChunkEnrichment,
  config: EnrichmentConfig,
  enrichChunk: EnrichChunkFn,
): Promise<StructureAwareChunk> {
  if (planned.decision.status === "skipped_by_policy") {
    return applyEnrichmentMetadata(planned.chunk, getSkippedEnrichment(planned.decision));
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= config.modelProfile.maxRetries; attempt += 1) {
    try {
      const output = await withTimeout(
        enrichChunk(planned.chunk, config),
        config.modelProfile.timeoutMs,
      );
      return applyEnrichmentMetadata(
        planned.chunk,
        validateEnrichmentOutput(planned.chunk, output),
      );
    } catch (error) {
      lastError = error;
    }
  }

  const reason = lastError instanceof Error ? lastError.message : "invalid_enrichment_output";
  return applyEnrichmentMetadata(planned.chunk, getFailedEnrichment(reason));
}

// Enrich planned chunks with sequential or bounded-parallel execution while preserving per-chunk fallback semantics.
export async function enrichPlannedChunks(
  plannedChunks: PlannedChunkEnrichment[],
  config: EnrichmentConfig,
  enrichChunk: EnrichChunkFn,
): Promise<StructureAwareChunk[]> {
  const results = new Array<StructureAwareChunk>(plannedChunks.length);
  const workerCount = Math.min(getConfiguredConcurrency(config), plannedChunks.length || 1);
  let nextIndex = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= plannedChunks.length) {
        return;
      }

      results[currentIndex] = await enrichOnePlannedChunk(
        plannedChunks[currentIndex],
        config,
        enrichChunk,
      );
    }
  });

  await Promise.all(workers);
  return results;
}

// Plan and enrich chunks in one ingestion-facing step so callers can persist the enriched chunk contract directly.
export async function enrichChunksForIngestion(
  chunks: StructureAwareChunk[],
  config: EnrichmentConfig,
  enrichChunk: EnrichChunkFn,
): Promise<StructureAwareChunk[]> {
  const plannedChunks = planChunkEnrichment(chunks, config);
  return enrichPlannedChunks(plannedChunks, config, enrichChunk);
}
