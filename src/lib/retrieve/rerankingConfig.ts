export interface RerankingConfig {
  enabled: boolean;
  candidateCount: number;
  timeoutMs: number;
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

// Resolve reranking settings with deterministic defaults for rollout safety.
export function resolveRerankingConfig(
  env: NodeJS.ProcessEnv = process.env,
): RerankingConfig {
  return {
    enabled: parseBoolean(env.RERANKING_ENABLED, false),
    candidateCount: parsePositiveInteger(
      env.RERANKING_CANDIDATE_COUNT,
      10,
      "RERANKING_CANDIDATE_COUNT",
    ),
    timeoutMs: parsePositiveInteger(env.RERANKING_TIMEOUT_MS, 2500, "RERANKING_TIMEOUT_MS"),
    debug: parseBoolean(env.RERANKING_DEBUG, false),
  };
}
