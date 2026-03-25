import type { QueryRewriteConfig } from "./queryRewriteConfig";

export type QueryRewriteEligibilityReason =
  | "eligible"
  | "disabled"
  | "query_too_short"
  | "query_too_long"
  | "identifier_like"
  | "quoted_query"
  | "context_dependent";

export interface QueryRewriteEligibility {
  eligible: boolean;
  normalizedQuery: string;
  reason: QueryRewriteEligibilityReason;
}

const MAX_QUERY_WORDS = 30;
const QUESTION_OPENERS = ["how", "what", "why", "when", "where"];
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
  return /^["'`].+["'`]$/.test(query);
}

function isContextDependentQuery(query: string): boolean {
  return CONTEXT_DEPENDENT_PATTERNS.some((pattern) => pattern.test(query));
}

function isNaturalLanguageQuestion(query: string): boolean {
  const lower = query.toLowerCase();
  return QUESTION_OPENERS.some((word) => lower.startsWith(`${word} `));
}

function isIdentifierLikeQuery(query: string): boolean {
  const hasIdentifierPunctuation = /[_./():{}-]/.test(query);
  const hasCamelCase = /[a-z][A-Z]/.test(query);
  if (isNaturalLanguageQuestion(query)) {
    return false;
  }

  return hasIdentifierPunctuation || hasCamelCase;
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
