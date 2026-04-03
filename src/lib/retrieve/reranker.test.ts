import { describe, expect, it, vi } from "vitest";
import { rerankCandidates, type RerankingCandidate } from "./reranker";
import { resolveRerankingConfig } from "./rerankingConfig";

function rerankingConfig(overrides: Record<string, string> = {}) {
  return resolveRerankingConfig({
    RERANKING_ENABLED: "true",
    ...overrides,
  } as unknown as NodeJS.ProcessEnv);
}

function makeCandidate(
  chunkId: string,
  overrides: Partial<RerankingCandidate> = {},
): RerankingCandidate {
  return {
    chunkId,
    content: `${chunkId} content`,
    url: `https://vite.dev/${chunkId}`,
    title: chunkId,
    anchor: null,
    similarity: 0.8,
    matchedBy: ["vector_original"],
    ...overrides,
  };
}

describe("rerankCandidates", () => {
  it("reorders bounded candidates and returns diagnostics when the model output is valid", async () => {
    const result = await rerankCandidates(
      {
        originalQuery: "How do environment variables work in Vite?",
        rewrittenQuery: "Vite environment variables import.meta.env VITE_ prefix",
        candidates: [
          makeCandidate("chunk-1"),
          makeCandidate("chunk-2"),
          makeCandidate("chunk-3"),
        ],
        limit: 2,
      },
      rerankingConfig({ RERANKING_CANDIDATE_COUNT: "3" }),
      {
        rerankModel: vi.fn().mockResolvedValue(`{
          "rankedIds":["chunk-2","chunk-1","chunk-3"],
          "diagnostics":[
            {"chunkId":"chunk-2","score":0.97,"reason":"best direct answer"},
            {"chunkId":"chunk-1","score":0.82,"reason":"supporting context"},
            {"chunkId":"chunk-3","score":0.31,"reason":"less direct"}
          ]
        }`),
      },
    );

    expect(result).toEqual({
      applied: true,
      status: "applied",
      inputCount: 3,
      outputCount: 2,
      beforeIds: ["chunk-1", "chunk-2", "chunk-3"],
      afterIds: ["chunk-2", "chunk-1"],
      diagnostics: [
        { chunkId: "chunk-2", score: 0.97, reason: "best direct answer" },
        { chunkId: "chunk-1", score: 0.82, reason: "supporting context" },
      ],
      candidates: [
        makeCandidate("chunk-2"),
        makeCandidate("chunk-1"),
      ],
    });
  });

  it("skips reranking when the feature is disabled", async () => {
    const rerankModel = vi.fn();
    const result = await rerankCandidates(
      {
        originalQuery: "import.meta.env",
        rewrittenQuery: null,
        candidates: [makeCandidate("chunk-1"), makeCandidate("chunk-2")],
        limit: 2,
      },
      resolveRerankingConfig({} as NodeJS.ProcessEnv),
      { rerankModel },
    );

    expect(rerankModel).not.toHaveBeenCalled();
    expect(result).toEqual({
      applied: false,
      status: "skipped_disabled",
      inputCount: 2,
      outputCount: 2,
      beforeIds: ["chunk-1", "chunk-2"],
      afterIds: ["chunk-1", "chunk-2"],
      diagnostics: [],
      candidates: [makeCandidate("chunk-1"), makeCandidate("chunk-2")],
    });
  });

  it("skips reranking when the bounded candidate count is already at or below the final limit", async () => {
    const rerankModel = vi.fn();
    const result = await rerankCandidates(
      {
        originalQuery: "vite build",
        rewrittenQuery: null,
        candidates: [makeCandidate("chunk-1"), makeCandidate("chunk-2"), makeCandidate("chunk-3")],
        limit: 3,
      },
      rerankingConfig({ RERANKING_CANDIDATE_COUNT: "5" }),
      { rerankModel },
    );

    expect(rerankModel).not.toHaveBeenCalled();
    expect(result).toEqual({
      applied: false,
      status: "skipped_below_limit",
      inputCount: 3,
      outputCount: 3,
      beforeIds: ["chunk-1", "chunk-2", "chunk-3"],
      afterIds: ["chunk-1", "chunk-2", "chunk-3"],
      diagnostics: [],
      candidates: [
        makeCandidate("chunk-1"),
        makeCandidate("chunk-2"),
        makeCandidate("chunk-3"),
      ],
    });
  });

  it("falls back deterministically when the model output is not a valid permutation", async () => {
    const result = await rerankCandidates(
      {
        originalQuery: "resolve.alias",
        rewrittenQuery: null,
        candidates: [
          makeCandidate("chunk-1"),
          makeCandidate("chunk-2"),
          makeCandidate("chunk-3"),
        ],
        limit: 2,
      },
      rerankingConfig({ RERANKING_CANDIDATE_COUNT: "3" }),
      {
        rerankModel: vi.fn().mockResolvedValue(`{
          "rankedIds":["chunk-2","chunk-2","chunk-unknown"]
        }`),
      },
    );

    expect(result).toEqual({
      applied: false,
      status: "fallback_invalid_output",
      inputCount: 3,
      outputCount: 2,
      beforeIds: ["chunk-1", "chunk-2", "chunk-3"],
      afterIds: ["chunk-1", "chunk-2"],
      diagnostics: [],
      candidates: [
        makeCandidate("chunk-1"),
        makeCandidate("chunk-2"),
      ],
    });
  });

  it("falls back deterministically when the model output is malformed JSON", async () => {
    const result = await rerankCandidates(
      {
        originalQuery: "server.proxy",
        rewrittenQuery: null,
        candidates: [
          makeCandidate("chunk-1"),
          makeCandidate("chunk-2"),
          makeCandidate("chunk-3"),
        ],
        limit: 2,
      },
      rerankingConfig({ RERANKING_CANDIDATE_COUNT: "3" }),
      {
        rerankModel: vi.fn().mockResolvedValue("not-json-at-all"),
      },
    );

    expect(result).toEqual({
      applied: false,
      status: "fallback_invalid_output",
      inputCount: 3,
      outputCount: 2,
      beforeIds: ["chunk-1", "chunk-2", "chunk-3"],
      afterIds: ["chunk-1", "chunk-2"],
      diagnostics: [],
      candidates: [
        makeCandidate("chunk-1"),
        makeCandidate("chunk-2"),
      ],
    });
  });

  it("falls back deterministically when the model call fails", async () => {
    const result = await rerankCandidates(
      {
        originalQuery: "vite preview",
        rewrittenQuery: null,
        candidates: [
          makeCandidate("chunk-1"),
          makeCandidate("chunk-2"),
          makeCandidate("chunk-3"),
        ],
        limit: 2,
      },
      rerankingConfig({ RERANKING_CANDIDATE_COUNT: "3" }),
      {
        rerankModel: vi.fn().mockRejectedValue(new Error("upstream unavailable")),
      },
    );

    expect(result).toEqual({
      applied: false,
      status: "fallback_model_failed",
      inputCount: 3,
      outputCount: 2,
      beforeIds: ["chunk-1", "chunk-2", "chunk-3"],
      afterIds: ["chunk-1", "chunk-2"],
      diagnostics: [],
      candidates: [
        makeCandidate("chunk-1"),
        makeCandidate("chunk-2"),
      ],
    });
  });

  it("falls back deterministically when reranking times out", async () => {
    const result = await rerankCandidates(
      {
        originalQuery: "optimizeDeps",
        rewrittenQuery: null,
        candidates: [
          makeCandidate("chunk-1"),
          makeCandidate("chunk-2"),
          makeCandidate("chunk-3"),
        ],
        limit: 2,
      },
      rerankingConfig({
        RERANKING_CANDIDATE_COUNT: "3",
        RERANKING_TIMEOUT_MS: "5",
      }),
      {
        rerankModel: () => new Promise<string>((resolve) => setTimeout(() => resolve("{}"), 25)),
      },
    );

    expect(result).toEqual({
      applied: false,
      status: "fallback_timeout",
      inputCount: 3,
      outputCount: 2,
      beforeIds: ["chunk-1", "chunk-2", "chunk-3"],
      afterIds: ["chunk-1", "chunk-2"],
      diagnostics: [],
      candidates: [
        makeCandidate("chunk-1"),
        makeCandidate("chunk-2"),
      ],
    });
  });
});
