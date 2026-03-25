import type { StructureAwareChunk } from "./structureTypes";

export interface EnrichmentModelProfile {
  model: string;
  apiVersion: string;
  mode: "sequential" | "bounded_parallel";
  maxConcurrency: number;
  timeoutMs: number;
  maxRetries: number;
}

export interface EnrichmentConfig {
  modelProfile: EnrichmentModelProfile;
  enabledContentKinds: StructureAwareChunk["metadata"]["content_kind"][];
  minChars: number;
}

export interface ChunkEnrichmentDecision {
  status: "eligible" | "skipped_by_policy";
  reason?: "content_kind_not_enabled" | "below_min_chars";
}

export interface PlannedChunkEnrichment {
  chunk: StructureAwareChunk;
  decision: ChunkEnrichmentDecision;
}

const ALL_CONTENT_KINDS: StructureAwareChunk["metadata"]["content_kind"][] = [
  "prose",
  "table",
  "code",
  "mixed",
  "list",
  "blockquote",
];

// Parse a positive integer env value and fall back when it is absent.
function parsePositiveInteger(
  rawValue: string | undefined,
  fallback: number,
  envName: string,
): number {
  if (!rawValue) return fallback;
  const parsed = Number.parseInt(rawValue, 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer`);
  }

  return parsed;
}

// Parse a non-negative integer env value and fall back when it is absent.
function parseNonNegativeInteger(
  rawValue: string | undefined,
  fallback: number,
  envName: string,
): number {
  if (!rawValue) return fallback;
  const parsed = Number.parseInt(rawValue, 10);

  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`${envName} must be a non-negative integer`);
  }

  return parsed;
}

// Parse the configured content kinds and reject unsupported values early.
function parseEnabledContentKinds(
  rawValue: string | undefined,
): StructureAwareChunk["metadata"]["content_kind"][] {
  const parsedKinds = (rawValue || "prose,table,code")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  for (const kind of parsedKinds) {
    if (!ALL_CONTENT_KINDS.includes(kind as StructureAwareChunk["metadata"]["content_kind"])) {
      throw new Error(`Unsupported enrichment content kind: ${kind}`);
    }
  }

  return parsedKinds as StructureAwareChunk["metadata"]["content_kind"][];
}

// Resolve the active enrichment model profile from env-like input with deterministic defaults.
export function resolveEnrichmentConfig(
  env: NodeJS.ProcessEnv = process.env,
): EnrichmentConfig {
  const mode = env.ENRICH_EXECUTION_MODE === "bounded_parallel"
    ? "bounded_parallel"
    : "sequential";
  const configuredConcurrency = parsePositiveInteger(
    env.ENRICH_MAX_CONCURRENCY,
    1,
    "ENRICH_MAX_CONCURRENCY",
  );
  const timeoutMs = parsePositiveInteger(env.ENRICH_TIMEOUT_MS, 15000, "ENRICH_TIMEOUT_MS");
  const maxRetries = parseNonNegativeInteger(env.ENRICH_MAX_RETRIES, 2, "ENRICH_MAX_RETRIES");
  const enabledContentKinds = parseEnabledContentKinds(env.ENRICH_METADATA_CONTENT_KINDS);
  const minChars = parsePositiveInteger(env.ENRICH_METADATA_MIN_CHARS, 300, "ENRICH_METADATA_MIN_CHARS");

  if (mode === "bounded_parallel" && configuredConcurrency < 2) {
    throw new Error(
      "ENRICH_MAX_CONCURRENCY must be at least 2 when ENRICH_EXECUTION_MODE is bounded_parallel",
    );
  }

  return {
    modelProfile: {
      model: env.ENRICH_MODEL_NAME || "gemini-2.5-flash",
      apiVersion: env.ENRICH_MODEL_API_VERSION || "v1beta",
      mode,
      maxConcurrency: mode === "sequential" ? 1 : configuredConcurrency,
      timeoutMs,
      maxRetries,
    },
    enabledContentKinds,
    minChars,
  };
}

// Decide whether a chunk should be enriched under the current policy settings.
export function getChunkEnrichmentDecision(
  chunk: StructureAwareChunk,
  config: EnrichmentConfig,
): ChunkEnrichmentDecision {
  if (!config.enabledContentKinds.includes(chunk.metadata.content_kind)) {
    return {
      status: "skipped_by_policy",
      reason: "content_kind_not_enabled",
    };
  }

  if (chunk.metadata.content_kind === "table") {
    return { status: "eligible" };
  }

  if (chunk.content.length < config.minChars) {
    return {
      status: "skipped_by_policy",
      reason: "below_min_chars",
    };
  }

  return { status: "eligible" };
}

// Plan enrichment decisions for a chunk batch so ingestion can adopt policy checks without changing persistence yet.
export function planChunkEnrichment(
  chunks: StructureAwareChunk[],
  config: EnrichmentConfig,
): PlannedChunkEnrichment[] {
  return chunks.map((chunk) => ({
    chunk,
    decision: getChunkEnrichmentDecision(chunk, config),
  }));
}
