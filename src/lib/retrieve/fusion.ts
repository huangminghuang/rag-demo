export type RetrievalMatchSource = "original" | "rewritten" | "both";

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

function getMatchPriority(source: RetrievalMatchSource): number {
  if (source === "both") return 0;
  if (source === "original") return 1;
  return 2;
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
