const DEFAULT_QUERY_QUOTA_RPM = 15;
const DEFAULT_QUERY_QUOTA_TPM = 250_000;
const DEFAULT_QUERY_QUOTA_RPD = 500;
const DEFAULT_QUERY_OUTPUT_TOKEN_RESERVE = 1024;

interface QuotaConfig {
  rpm: number;
  tpm: number;
  rpd: number;
  outputTokenReserve: number;
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

function getQuotaConfig(): QuotaConfig {
  return {
    rpm: parsePositiveInt(process.env.QUERY_QUOTA_RPM, DEFAULT_QUERY_QUOTA_RPM),
    tpm: parsePositiveInt(process.env.QUERY_QUOTA_TPM, DEFAULT_QUERY_QUOTA_TPM),
    rpd: parsePositiveInt(process.env.QUERY_QUOTA_RPD, DEFAULT_QUERY_QUOTA_RPD),
    outputTokenReserve: parsePositiveInt(
      process.env.QUERY_QUOTA_OUTPUT_TOKEN_RESERVE,
      DEFAULT_QUERY_OUTPUT_TOKEN_RESERVE
    ),
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
    minuteBucket = {
      windowStartMs: minuteStart,
      requests: 0,
      tokens: 0,
    };
  }

  const now = new Date(nowMs);
  const dayKey = getUtcDayKey(now);
  if (dayBucket.dayKey !== dayKey) {
    dayBucket = {
      dayKey,
      requests: 0,
    };
  }
}

// Fast approximation suitable for quota gating without tokenizer calls.
function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateQueryTokens(inputTexts: string[]): number {
  return inputTexts.reduce((sum, text) => sum + estimateTokensFromText(text), 0);
}

export function getQueryQuotaConfig(): QuotaConfig {
  return getQuotaConfig();
}

export function consumeQueryQuota(estimatedInputTokens: number): QuotaCheckResult {
  const nowMs = Date.now();
  resetBucketsIfNeeded(nowMs);

  const config = getQuotaConfig();
  const estimatedTotalTokens = estimatedInputTokens + config.outputTokenReserve;

  if (minuteBucket.requests + 1 > config.rpm) {
    return {
      allowed: false,
      reason: "rpm",
      message: `Query RPM limit reached (${config.rpm}/min).`,
      retryAfterSeconds: secondsUntilNextMinute(nowMs),
    };
  }

  if (minuteBucket.tokens + estimatedTotalTokens > config.tpm) {
    return {
      allowed: false,
      reason: "tpm",
      message: `Query TPM limit reached (${config.tpm}/min).`,
      retryAfterSeconds: secondsUntilNextMinute(nowMs),
    };
  }

  if (dayBucket.requests + 1 > config.rpd) {
    return {
      allowed: false,
      reason: "rpd",
      message: `Query RPD limit reached (${config.rpd}/day).`,
      retryAfterSeconds: secondsUntilUtcDayEnd(new Date(nowMs)),
    };
  }

  minuteBucket.requests += 1;
  minuteBucket.tokens += estimatedTotalTokens;
  dayBucket.requests += 1;

  return { allowed: true };
}
