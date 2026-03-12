const DEFAULT_RETRIEVE_THRESHOLD = 0.55;
const DEFAULT_CHAT_RETRIEVE_THRESHOLD = 0.6;

function parseThreshold(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed)) return fallback;
  if (parsed < 0 || parsed > 1) return fallback;
  return parsed;
}

export function getDefaultRetrieveThreshold(): number {
  return parseThreshold(process.env.RETRIEVE_THRESHOLD_DEFAULT, DEFAULT_RETRIEVE_THRESHOLD);
}

export function getChatRetrieveThreshold(): number {
  return parseThreshold(process.env.CHAT_RETRIEVE_THRESHOLD, DEFAULT_CHAT_RETRIEVE_THRESHOLD);
}

export function resolveRetrieveThreshold(override: unknown): number {
  if (typeof override === "number") {
    if (override >= 0 && override <= 1) return override;
    return getDefaultRetrieveThreshold();
  }

  if (typeof override === "string") {
    const parsed = Number.parseFloat(override);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      return parsed;
    }
  }

  return getDefaultRetrieveThreshold();
}
