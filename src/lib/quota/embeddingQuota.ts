const DEFAULT_EMBED_QUOTA_RPM = 100;
const DEFAULT_EMBED_QUOTA_TPM = 30_000;
const DEFAULT_EMBED_QUOTA_RPD = 1_000;

interface EmbeddingQuotaConfig {
  rpm: number;
  tpm: number;
  rpd: number;
}

interface MinuteBucket {
  windowStartMs: number;
  requests: number;
  tokens: number;
}

interface DayBucket {
  dayKey: string;
  requests: number;
}

interface QuotaCheckResult {
  allowed: boolean;
  reason?: "rpm" | "tpm" | "rpd";
  message?: string;
  retryAfterSeconds?: number;
}

export class EmbeddingQuotaExceededError extends Error {
  reason: "rpm" | "tpm" | "rpd";
  retryAfterSeconds: number;
  limits: EmbeddingQuotaConfig;

  constructor(
    message: string,
    reason: "rpm" | "tpm" | "rpd",
    retryAfterSeconds: number,
    limits: EmbeddingQuotaConfig
  ) {
    super(message);
    this.name = "EmbeddingQuotaExceededError";
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
    this.limits = limits;
  }
}

let minuteBucket: MinuteBucket = {
  windowStartMs: getMinuteWindowStart(Date.now()),
  requests: 0,
  tokens: 0,
};

let dayBucket: DayBucket = {
  dayKey: getUtcDayKey(new Date()),
  requests: 0,
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

function getConfig(): EmbeddingQuotaConfig {
  return {
    rpm: parsePositiveInt(process.env.EMBED_QUOTA_RPM, DEFAULT_EMBED_QUOTA_RPM),
    tpm: parsePositiveInt(process.env.EMBED_QUOTA_TPM, DEFAULT_EMBED_QUOTA_TPM),
    rpd: parsePositiveInt(process.env.EMBED_QUOTA_RPD, DEFAULT_EMBED_QUOTA_RPD),
  };
}

function getMinuteWindowStart(timestampMs: number): number {
  return Math.floor(timestampMs / 60_000) * 60_000;
}

function getUtcDayKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate()
  ).padStart(2, "0")}`;
}

function secondsUntilNextMinute(timestampMs: number): number {
  return Math.max(1, Math.ceil((getMinuteWindowStart(timestampMs) + 60_000 - timestampMs) / 1000));
}

function secondsUntilUtcDayEnd(date: Date): number {
  const nextDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return Math.max(1, Math.ceil((nextDay - date.getTime()) / 1000));
}

function resetBucketsIfNeeded(nowMs: number): void {
  const minuteStart = getMinuteWindowStart(nowMs);
  if (minuteBucket.windowStartMs !== minuteStart) {
    minuteBucket = { windowStartMs: minuteStart, requests: 0, tokens: 0 };
  }

  const dayKey = getUtcDayKey(new Date(nowMs));
  if (dayBucket.dayKey !== dayKey) {
    dayBucket = { dayKey, requests: 0 };
  }
}

function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateEmbeddingTokens(texts: string[]): number {
  return texts.reduce((sum, text) => sum + estimateTokensFromText(text), 0);
}

function consumeEmbeddingQuota(estimatedInputTokens: number): QuotaCheckResult {
  const nowMs = Date.now();
  resetBucketsIfNeeded(nowMs);
  const config = getConfig();

  if (minuteBucket.requests + 1 > config.rpm) {
    return {
      allowed: false,
      reason: "rpm",
      message: `Embedding RPM limit reached (${config.rpm}/min).`,
      retryAfterSeconds: secondsUntilNextMinute(nowMs),
    };
  }

  if (minuteBucket.tokens + estimatedInputTokens > config.tpm) {
    return {
      allowed: false,
      reason: "tpm",
      message: `Embedding TPM limit reached (${config.tpm}/min).`,
      retryAfterSeconds: secondsUntilNextMinute(nowMs),
    };
  }

  if (dayBucket.requests + 1 > config.rpd) {
    return {
      allowed: false,
      reason: "rpd",
      message: `Embedding RPD limit reached (${config.rpd}/day).`,
      retryAfterSeconds: secondsUntilUtcDayEnd(new Date(nowMs)),
    };
  }

  minuteBucket.requests += 1;
  minuteBucket.tokens += estimatedInputTokens;
  dayBucket.requests += 1;

  return { allowed: true };
}

export function enforceEmbeddingQuota(estimatedInputTokens: number): void {
  const result = consumeEmbeddingQuota(estimatedInputTokens);
  if (result.allowed) return;

  const config = getConfig();
  throw new EmbeddingQuotaExceededError(
    result.message || "Embedding quota exceeded.",
    result.reason || "rpm",
    result.retryAfterSeconds || 1,
    config
  );
}

export function isEmbeddingQuotaExceededError(error: unknown): error is EmbeddingQuotaExceededError {
  return error instanceof EmbeddingQuotaExceededError;
}
