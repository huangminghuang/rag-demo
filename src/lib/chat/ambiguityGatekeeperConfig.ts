export interface AmbiguityGatekeeperConfig {
  enabled: boolean;
  modelName: string;
  apiVersion: string;
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
  const normalized = rawValue.trim();

  if (!/^[0-9]+$/.test(normalized)) {
    throw new Error(`${envName} must be a positive integer`);
  }

  const parsed = Number.parseInt(normalized, 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer`);
  }

  return parsed;
}

// Resolve ambiguity-gatekeeper settings with deterministic defaults for rollout safety.
export function resolveAmbiguityGatekeeperConfig(
  env: NodeJS.ProcessEnv = process.env,
): AmbiguityGatekeeperConfig {
  return {
    enabled: parseBoolean(env.AMBIGUITY_GATEKEEPER_ENABLED, false),
    modelName: env.AMBIGUITY_GATEKEEPER_MODEL_NAME || "gemini-2.5-flash",
    apiVersion: env.AMBIGUITY_GATEKEEPER_MODEL_API_VERSION || "v1beta",
    timeoutMs: parsePositiveInteger(
      env.AMBIGUITY_GATEKEEPER_TIMEOUT_MS,
      2000,
      "AMBIGUITY_GATEKEEPER_TIMEOUT_MS",
    ),
    debug: parseBoolean(env.AMBIGUITY_GATEKEEPER_DEBUG, false),
  };
}
