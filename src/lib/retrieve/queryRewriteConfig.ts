export interface QueryRewriteConfig {
  enabled: boolean;
  modelName: string;
  apiVersion: string;
  timeoutMs: number;
  maxRetries: number;
  debug: boolean;
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

function parseBoolean(rawValue: string | undefined, fallback: boolean): boolean {
  if (!rawValue) return fallback;
  return rawValue === "true";
}

// Resolve query rewrite settings with deterministic defaults for rollout safety.
export function resolveQueryRewriteConfig(
  env: NodeJS.ProcessEnv = process.env,
): QueryRewriteConfig {
  return {
    enabled: parseBoolean(env.QUERY_REWRITE_ENABLED, false),
    modelName: env.QUERY_REWRITE_MODEL_NAME || "gemini-2.5-flash",
    apiVersion: env.QUERY_REWRITE_MODEL_API_VERSION || "v1beta",
    timeoutMs: parsePositiveInteger(env.QUERY_REWRITE_TIMEOUT_MS, 3000, "QUERY_REWRITE_TIMEOUT_MS"),
    maxRetries: parseNonNegativeInteger(env.QUERY_REWRITE_MAX_RETRIES, 1, "QUERY_REWRITE_MAX_RETRIES"),
    debug: parseBoolean(env.QUERY_REWRITE_DEBUG, false),
  };
}
