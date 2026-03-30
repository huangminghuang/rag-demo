import { describe, expect, it } from "vitest";
import {
  fuseHybridRetrievalResults,
  fuseRetrievalResults,
  type RetrievalBranchResult,
} from "./fusion";

function createResult(
  chunkId: string,
  similarity: number,
  overrides: Partial<RetrievalBranchResult> = {},
): RetrievalBranchResult {
  return {
    chunkId,
    content: `content-${chunkId}`,
    url: `https://example.com/${chunkId}`,
    title: `title-${chunkId}`,
    anchor: null,
    similarity,
    ...overrides,
  };
}

describe("fuseRetrievalResults", () => {
  it("dedupes by stable chunk identity and keeps the maximum similarity score", () => {
    const results = fuseRetrievalResults({
      originalResults: [createResult("a", 0.72)],
      rewrittenResults: [createResult("a", 0.81)],
      limit: 5,
    });

    expect(results).toEqual([
      {
        ...createResult("a", 0.81),
        matchedBy: "both",
      },
    ]);
  });

  it("tracks provenance as original, rewritten, or both", () => {
    const results = fuseRetrievalResults({
      originalResults: [createResult("a", 0.72), createResult("b", 0.61)],
      rewrittenResults: [createResult("b", 0.63), createResult("c", 0.67)],
      limit: 5,
    });

    expect(results.map((result) => [result.chunkId, result.matchedBy])).toEqual([
      ["a", "original"],
      ["c", "rewritten"],
      ["b", "both"],
    ]);
  });

  it("prefers both, then original, then rewritten when similarity scores tie", () => {
    const results = fuseRetrievalResults({
      originalResults: [
        createResult("a", 0.7),
        createResult("b", 0.7),
      ],
      rewrittenResults: [
        createResult("b", 0.7),
        createResult("c", 0.7),
      ],
      limit: 5,
    });

    expect(results.map((result) => [result.chunkId, result.matchedBy])).toEqual([
      ["b", "both"],
      ["a", "original"],
      ["c", "rewritten"],
    ]);
  });

  it("keeps rewritten-only hits in the final top-N when they outrank weaker original hits", () => {
    const results = fuseRetrievalResults({
      originalResults: [createResult("a", 0.7), createResult("b", 0.51)],
      rewrittenResults: [createResult("c", 0.69), createResult("d", 0.68)],
      limit: 3,
    });

    expect(results.map((result) => result.chunkId)).toEqual(["a", "c", "d"]);
  });

  it("truncates to the requested final limit after fusion", () => {
    const results = fuseRetrievalResults({
      originalResults: [
        createResult("a", 0.9),
        createResult("b", 0.8),
      ],
      rewrittenResults: [
        createResult("c", 0.85),
        createResult("d", 0.75),
      ],
      limit: 2,
    });

    expect(results.map((result) => result.chunkId)).toEqual(["a", "c"]);
  });
});

describe("fuseHybridRetrievalResults", () => {
  it("dedupes by stable chunk identity across multiple hybrid branches", () => {
    const results = fuseHybridRetrievalResults({
      branches: [
        {
          source: "vector_original",
          results: [createResult("a", 0.72)],
        },
        {
          source: "lexical_original",
          results: [createResult("a", 0.65)],
        },
      ],
      limit: 5,
    });

    expect(results).toEqual([
      {
        ...createResult("a", 0.72),
        similarity: 1 / 61 + 1 / 61,
        matchedBy: ["vector_original", "lexical_original"],
      },
    ]);
  });

  it("keeps original-query branches weighted above rewritten-query branches", () => {
    const results = fuseHybridRetrievalResults({
      branches: [
        {
          source: "vector_original",
          results: [createResult("original", 0.5)],
        },
        {
          source: "vector_rewritten",
          results: [createResult("rewritten", 0.9)],
        },
      ],
      limit: 5,
    });

    expect(results.map((result) => result.chunkId)).toEqual(["original", "rewritten"]);
  });

  it("aggregates per-result matched branches", () => {
    const results = fuseHybridRetrievalResults({
      branches: [
        {
          source: "vector_original",
          results: [createResult("shared", 0.8)],
        },
        {
          source: "lexical_original",
          results: [createResult("shared", 0.6)],
        },
        {
          source: "lexical_rewritten",
          results: [createResult("shared", 0.7)],
        },
      ],
      limit: 5,
    });

    expect(results[0]?.matchedBy).toEqual([
      "vector_original",
      "lexical_original",
      "lexical_rewritten",
    ]);
  });

  it("prefers multi-branch matches when fused scores tie", () => {
    const results = fuseHybridRetrievalResults({
      branches: [
        {
          source: "vector_original",
          results: [createResult("shared", 0.9), createResult("single", 0.8)],
        },
        {
          source: "lexical_original",
          results: [createResult("shared", 0.7)],
        },
      ],
      limit: 5,
    });

    expect(results.map((result) => result.chunkId)).toEqual(["shared", "single"]);
  });

  it("truncates to the requested final limit after hybrid fusion", () => {
    const results = fuseHybridRetrievalResults({
      branches: [
        {
          source: "vector_original",
          results: [createResult("a", 0.9), createResult("b", 0.8)],
        },
        {
          source: "lexical_original",
          results: [createResult("c", 0.85), createResult("d", 0.75)],
        },
      ],
      limit: 2,
    });

    expect(results.map((result) => result.chunkId)).toEqual(["a", "c"]);
  });
});
