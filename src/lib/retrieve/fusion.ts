export type RetrievalMatchSource = "original" | "rewritten" | "both";
export type RetrievalBranchSource =
  | "vector_original"
  | "lexical_original"
  | "vector_rewritten"
  | "lexical_rewritten";

export interface RetrievalBranchResult {
  chunkId: string;
  content: string;
  url: string;
  title: string | null;
  anchor: string | null;
  similarity: number;
}

export interface FusedRetrievalResult extends RetrievalBranchResult {
  matchedBy: RetrievalMatchSource;
}

export interface HybridFusedRetrievalResult extends RetrievalBranchResult {
  matchedBy: RetrievalBranchSource[];
}

export interface RetrievalBranchInput {
  source: RetrievalBranchSource;
  results: RetrievalBranchResult[];
}

const RRF_K = 60;

function getMatchPriority(source: RetrievalMatchSource): number {
  if (source === "both") return 0;
  if (source === "original") return 1;
  return 2;
}

function getBranchWeight(source: RetrievalBranchSource): number {
  if (source === "vector_original" || source === "lexical_original") {
    return 1;
  }

  return 0.75;
}

function getBranchSourcePriority(source: RetrievalBranchSource): number {
  if (source === "vector_original") return 0;
  if (source === "lexical_original") return 1;
  if (source === "vector_rewritten") return 2;
  return 3;
}

function getOriginalFamilyMatchCount(sources: RetrievalBranchSource[]): number {
  return sources.filter(
    (source) => source === "vector_original" || source === "lexical_original",
  ).length;
}

function getBestBranchSimilaritySource(source: RetrievalBranchSource): number {
  if (source === "vector_original") return 0;
  if (source === "lexical_original") return 1;
  if (source === "vector_rewritten") return 2;
  return 3;
}

function mergeProvenance(
  current: RetrievalMatchSource,
  incoming: Exclude<RetrievalMatchSource, "both">,
): RetrievalMatchSource {
  if (current === incoming) {
    return current;
  }

  return "both";
}

// Fuse multiple vector and lexical branches with weighted reciprocal rank fusion for hybrid retrieval.
export function fuseHybridRetrievalResults(params: {
  branches: RetrievalBranchInput[];
  limit: number;
}): HybridFusedRetrievalResult[] {
  const merged = new Map<
    string,
    HybridFusedRetrievalResult & { bestBranchSimilarity: number; bestSource: RetrievalBranchSource }
  >();

  for (const branch of params.branches) {
    const branchWeight = getBranchWeight(branch.source);

    branch.results.forEach((result, index) => {
      const reciprocalRankScore = branchWeight / (RRF_K + index + 1);
      const existing = merged.get(result.chunkId);

      if (!existing) {
        merged.set(result.chunkId, {
          ...result,
          similarity: reciprocalRankScore,
          matchedBy: [branch.source],
          bestBranchSimilarity: result.similarity,
          bestSource: branch.source,
        });
        return;
      }

      const shouldReplacePayload = result.similarity > existing.bestBranchSimilarity;
      const nextMatchedBy = existing.matchedBy.includes(branch.source)
        ? existing.matchedBy
        : [...existing.matchedBy, branch.source].sort(
            (left, right) => getBranchSourcePriority(left) - getBranchSourcePriority(right),
          );

      merged.set(result.chunkId, {
        ...(shouldReplacePayload ? result : existing),
        similarity: existing.similarity + reciprocalRankScore,
        matchedBy: nextMatchedBy,
        bestBranchSimilarity: Math.max(existing.bestBranchSimilarity, result.similarity),
        bestSource: shouldReplacePayload ? branch.source : existing.bestSource,
      });
    });
  }

  return [...merged.values()]
    .sort((left, right) => {
      if (right.similarity !== left.similarity) {
        return right.similarity - left.similarity;
      }

      if (right.matchedBy.length !== left.matchedBy.length) {
        return right.matchedBy.length - left.matchedBy.length;
      }

      const originalFamilyDifference =
        getOriginalFamilyMatchCount(right.matchedBy) - getOriginalFamilyMatchCount(left.matchedBy);
      if (originalFamilyDifference !== 0) {
        return originalFamilyDifference;
      }

      if (right.bestBranchSimilarity !== left.bestBranchSimilarity) {
        return right.bestBranchSimilarity - left.bestBranchSimilarity;
      }

      const sourceDifference =
        getBestBranchSimilaritySource(left.bestSource) - getBestBranchSimilaritySource(right.bestSource);
      if (sourceDifference !== 0) {
        return sourceDifference;
      }

      return left.chunkId.localeCompare(right.chunkId);
    })
    .slice(0, params.limit)
    .map(({ bestBranchSimilarity: _bestBranchSimilarity, bestSource: _bestSource, ...result }) => ({
      ...result,
      matchedBy: [...result.matchedBy],
    }));
}

// Fuse original-query and rewritten-query retrieval results into one ranked list with provenance.
export function fuseRetrievalResults(params: {
  originalResults: RetrievalBranchResult[];
  rewrittenResults: RetrievalBranchResult[];
  limit: number;
}): FusedRetrievalResult[] {
  const merged = new Map<string, FusedRetrievalResult>();

  const upsert = (
    result: RetrievalBranchResult,
    source: Exclude<RetrievalMatchSource, "both">,
  ) => {
    const existing = merged.get(result.chunkId);

    if (!existing) {
      merged.set(result.chunkId, {
        ...result,
        matchedBy: source,
      });
      return;
    }

    merged.set(result.chunkId, {
      ...existing,
      ...result,
      similarity: Math.max(existing.similarity, result.similarity),
      matchedBy: mergeProvenance(existing.matchedBy, source),
    });
  };

  for (const result of params.originalResults) {
    upsert(result, "original");
  }

  for (const result of params.rewrittenResults) {
    upsert(result, "rewritten");
  }

  return [...merged.values()]
    .sort((a, b) => {
      if (b.similarity !== a.similarity) {
        return b.similarity - a.similarity;
      }

      return getMatchPriority(a.matchedBy) - getMatchPriority(b.matchedBy);
    })
    .slice(0, params.limit);
}
