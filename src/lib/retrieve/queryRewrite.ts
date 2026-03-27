import type { QueryRewriteConfig } from "./queryRewriteConfig";
import { buildQueryRewritePrompt } from "./queryRewritePrompt";

export type QueryRewriteEligibilityReason =
  | "eligible"
  | "disabled"
  | "query_too_short"
  | "query_too_long"
  | "identifier_like"
  | "quoted_query"
  | "context_dependent"
  | "equivalent_to_original"
  | "model_failed";

export interface QueryRewriteEligibility {
  eligible: boolean;
  normalizedQuery: string;
  reason: QueryRewriteEligibilityReason;
}

export type QueryRewriteDecision =
  | {
      applied: true;
      originalQuery: string;
      rewrittenQuery: string;
      reason: "applied";
    }
  | {
      applied: false;
      originalQuery: string;
      rewrittenQuery: null;
      reason: Exclude<QueryRewriteEligibilityReason, "eligible">;
    };

interface RewriteQueryForRetrievalDependencies {
  rewriteModel?: (prompt: string, config: QueryRewriteConfig) => Promise<string>;
}

const MAX_QUERY_WORDS = 30;
const QUESTION_OPENERS = ["how", "what", "why", "when", "where"];
const COMMAND_ENTRYPOINTS = new Set(["vite", "npm", "pnpm", "yarn", "bun", "npx", "node"]);
const COMMAND_TERMS = new Set([
  "build",
  "preview",
  "dev",
  "serve",
  "start",
  "run",
  "test",
  "install",
  "create",
  "add",
  "remove",
]);
const CONTEXT_DEPENDENT_PATTERNS = [
  /^what about\b/i,
  /^how does that\b/i,
  /^how does it\b/i,
  /^what about in\b/i,
];

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

function getWordCount(query: string): number {
  return query.split(/\s+/).filter(Boolean).length;
}

function isQuotedQuery(query: string): boolean {
  if (query.length < 2) {
    return false;
  }

  const firstCharacter = query[0];
  if (![`"`, "'", "`"].includes(firstCharacter)) {
    return false;
  }

  return query.indexOf(firstCharacter, 1) > 1;
}

function isContextDependentQuery(query: string): boolean {
  return CONTEXT_DEPENDENT_PATTERNS.some((pattern) => pattern.test(query));
}

function isNaturalLanguageQuestion(query: string): boolean {
  const lower = query.toLowerCase();
  return QUESTION_OPENERS.some((word) => lower.startsWith(`${word} `));
}

// Treat short CLI-style commands as exact inputs that should bypass rewrite.
function isCommandLikeQuery(query: string): boolean {
  if (isNaturalLanguageQuestion(query) || query.includes("?")) {
    return false;
  }

  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 5) {
    return false;
  }

  if (tokens.some((token) => !/^[a-z0-9._:/=-]+$/i.test(token))) {
    return false;
  }

  return (
    COMMAND_ENTRYPOINTS.has(tokens[0].toLowerCase()) ||
    tokens.some((token) => COMMAND_TERMS.has(token.toLowerCase()))
  );
}

function isIdentifierLikeQuery(query: string): boolean {
  const hasIdentifierPunctuation = /[_./():{}-]/.test(query);
  const hasCamelCase = /[a-z][A-Z]/.test(query);
  if (isNaturalLanguageQuestion(query)) {
    return false;
  }

  return hasIdentifierPunctuation || hasCamelCase || isCommandLikeQuery(query);
}

// Decide whether a query should be rewritten before retrieval, without calling the model yet.
export function decideQueryRewriteEligibility(
  query: string,
  config: QueryRewriteConfig,
): QueryRewriteEligibility {
  const normalizedQuery = normalizeQuery(query);

  if (!config.enabled) {
    return { eligible: false, normalizedQuery, reason: "disabled" };
  }

  const wordCount = getWordCount(normalizedQuery);

  if (isQuotedQuery(normalizedQuery)) {
    return { eligible: false, normalizedQuery, reason: "quoted_query" };
  }

  if (wordCount < 2 && !isIdentifierLikeQuery(normalizedQuery)) {
    return { eligible: false, normalizedQuery, reason: "query_too_short" };
  }

  if (wordCount > MAX_QUERY_WORDS) {
    return { eligible: false, normalizedQuery, reason: "query_too_long" };
  }

  if (isIdentifierLikeQuery(normalizedQuery)) {
    return { eligible: false, normalizedQuery, reason: "identifier_like" };
  }

  if (isContextDependentQuery(normalizedQuery)) {
    return { eligible: false, normalizedQuery, reason: "context_dependent" };
  }

  return { eligible: true, normalizedQuery, reason: "eligible" };
}

function normalizeRewrittenQuery(query: string): string | null {
  const normalized = normalizeQuery(query);
  return normalized.length > 0 ? normalized : null;
}

function areEquivalentQueries(originalQuery: string, rewrittenQuery: string): boolean {
  return normalizeQuery(originalQuery).toLowerCase() === normalizeQuery(rewrittenQuery).toLowerCase();
}

function logQueryRewriteDecision(
  config: QueryRewriteConfig,
  decision: QueryRewriteDecision,
): void {
  if (!config.debug) {
    return;
  }

  console.info("[query-rewrite-debug]", {
    originalQuery: decision.originalQuery,
    rewrittenQuery: decision.rewrittenQuery,
    reason: decision.reason,
  });
}

async function rewriteQueryWithModel(
  prompt: string,
  config: QueryRewriteConfig,
): Promise<string> {
  const { getQueryRewriteGenAI } = await import("@/lib/gemini");
  const model = getQueryRewriteGenAI().getGenerativeModel(
    { model: config.modelName },
    { apiVersion: config.apiVersion },
  );
  const result = await model.generateContent(prompt);
  return result.response.text();
}

// Decide whether to rewrite a query and, when eligible, attempt to generate one rewritten retrieval query.
export async function rewriteQueryForRetrieval(
  query: string,
  config: QueryRewriteConfig,
  dependencies: RewriteQueryForRetrievalDependencies = {},
): Promise<QueryRewriteDecision> {
  const eligibility = decideQueryRewriteEligibility(query, config);

  if (!eligibility.eligible) {
    const decision: QueryRewriteDecision = {
      applied: false,
      originalQuery: eligibility.normalizedQuery,
      rewrittenQuery: null,
      reason: eligibility.reason,
    };
    logQueryRewriteDecision(config, decision);
    return decision;
  }

  const rewriteModel = dependencies.rewriteModel || rewriteQueryWithModel;

  try {
    const rewrittenRaw = await rewriteModel(
      buildQueryRewritePrompt(eligibility.normalizedQuery),
      config,
    );
    const rewrittenQuery = normalizeRewrittenQuery(rewrittenRaw);

    if (!rewrittenQuery || areEquivalentQueries(eligibility.normalizedQuery, rewrittenQuery)) {
      const decision: QueryRewriteDecision = {
        applied: false,
        originalQuery: eligibility.normalizedQuery,
        rewrittenQuery: null,
        reason: "equivalent_to_original",
      };
      logQueryRewriteDecision(config, decision);
      return decision;
    }

    const decision: QueryRewriteDecision = {
      applied: true,
      originalQuery: eligibility.normalizedQuery,
      rewrittenQuery,
      reason: "applied",
    };
    logQueryRewriteDecision(config, decision);
    return decision;
  } catch {
    const decision: QueryRewriteDecision = {
      applied: false,
      originalQuery: eligibility.normalizedQuery,
      rewrittenQuery: null,
      reason: "model_failed",
    };
    logQueryRewriteDecision(config, decision);
    return decision;
  }
}
