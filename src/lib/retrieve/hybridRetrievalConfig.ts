export interface HybridRetrievalConfig {
  enabled: boolean;
  trigramThreshold: number;
  preFusionLimit: number;
  debug: boolean;
}

function parseBoolean(rawValue: string | undefined, fallback: boolean): boolean {
  if (!rawValue) return fallback;
  return rawValue === "true";
}

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

function parseUnitIntervalNumber(
  rawValue: string | undefined,
  fallback: number,
  envName: string,
): number {
  if (!rawValue) return fallback;
  const parsed = Number.parseFloat(rawValue);

  if (Number.isNaN(parsed) || parsed <= 0 || parsed >= 1) {
    throw new Error(`${envName} must be a number between 0 and 1`);
  }

  return parsed;
}

// Resolve hybrid retrieval settings with deterministic defaults for rollout safety.
export function resolveHybridRetrievalConfig(
  env: NodeJS.ProcessEnv = process.env,
): HybridRetrievalConfig {
  return {
    enabled: parseBoolean(env.HYBRID_RETRIEVAL_ENABLED, false),
    trigramThreshold: parseUnitIntervalNumber(
      env.HYBRID_LEXICAL_TRIGRAM_THRESHOLD,
      0.18,
      "HYBRID_LEXICAL_TRIGRAM_THRESHOLD",
    ),
    preFusionLimit: parsePositiveInteger(
      env.HYBRID_PRE_FUSION_LIMIT,
      12,
      "HYBRID_PRE_FUSION_LIMIT",
    ),
    debug: parseBoolean(env.HYBRID_RETRIEVAL_DEBUG, false),
  };
}
