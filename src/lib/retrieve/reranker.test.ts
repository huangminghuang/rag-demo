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

  it("builds a prompt that prioritizes answer usefulness, exact matches, docs metadata, and diversity", async () => {
    const rerankModel = vi.fn().mockResolvedValue(`{
      "rankedIds":["chunk-1","chunk-2","chunk-3"]
    }`);

    await rerankCandidates(
      {
        originalQuery: "How do environment variables work in Vite, and what is the VITE_ prefix for?",
        rewrittenQuery: "Vite environment variables import.meta.env VITE_ prefix env exposure",
        history: [
          "User previously asked about env files.",
          "Assistant mentioned mode-specific loading.",
        ],
        candidates: [
          makeCandidate("chunk-1", {
            title: "Env Variables and Modes",
            url: "https://vite.dev/guide/env-and-mode",
            anchor: "env-variables",
            matchedBy: ["lexical_original"],
            content: "Use import.meta.env to expose VITE_ variables to client code.",
          }),
          makeCandidate("chunk-2", {
            title: "Config Reference",
            url: "https://vite.dev/config/shared-options",
            anchor: "resolve-alias",
            matchedBy: ["vector_original", "lexical_rewritten"],
          }),
          makeCandidate("chunk-3"),
        ],
        limit: 2,
      },
      rerankingConfig({ RERANKING_CANDIDATE_COUNT: "3" }),
      { rerankModel },
    );

    const prompt = rerankModel.mock.calls[0][0];
    expect(prompt).toContain("Rank the candidates for how useful they are for answering the user's question.");
    expect(prompt).toContain("Preserve exact technical matches when they are directly relevant");
    expect(prompt).toContain("Prefer distinct useful evidence over near-duplicate chunks");
    expect(prompt).toContain("Original user question:");
    expect(prompt).toContain("How do environment variables work in Vite, and what is the VITE_ prefix for?");
    expect(prompt).toContain("Rewritten retrieval query:");
    expect(prompt).toContain("Vite environment variables import.meta.env VITE_ prefix env exposure");
    expect(prompt).toContain("Conversation history:");
    expect(prompt).toContain("title: Env Variables and Modes");
    expect(prompt).toContain("url: https://vite.dev/guide/env-and-mode");
    expect(prompt).toContain("anchor: env-variables");
    expect(prompt).toContain("matchedBy: lexical_original");
    expect(prompt).toContain("matchedBy: vector_original, lexical_rewritten");
  });

  it("allows exact identifier-style queries to keep precise lexical hits above broader prose", async () => {
    const result = await rerankCandidates(
      {
        originalQuery: "import.meta.env",
        rewrittenQuery: null,
        candidates: [
          makeCandidate("chunk-broad", {
            title: "General Guide",
            url: "https://vite.dev/guide/env-and-mode",
            content: "General environment variables guide.",
            matchedBy: ["vector_original"],
          }),
          makeCandidate("chunk-exact", {
            title: "Env Variables and Modes",
            url: "https://vite.dev/guide/env-and-mode",
            anchor: "env-variables",
            content: "Use import.meta.env to access client-exposed environment variables.",
            matchedBy: ["lexical_original"],
          }),
          makeCandidate("chunk-other"),
        ],
        limit: 2,
      },
      rerankingConfig({ RERANKING_CANDIDATE_COUNT: "3" }),
      {
        rerankModel: vi.fn().mockResolvedValue(`{
          "rankedIds":["chunk-exact","chunk-broad","chunk-other"],
          "diagnostics":[
            {"chunkId":"chunk-exact","score":0.99,"reason":"exact identifier hit"},
            {"chunkId":"chunk-broad","score":0.62,"reason":"broader supporting context"},
            {"chunkId":"chunk-other","score":0.11,"reason":"less relevant"}
          ]
        }`),
      },
    );

    expect(result.afterIds).toEqual(["chunk-exact", "chunk-broad"]);
    expect(result.candidates[0]?.matchedBy).toEqual(["lexical_original"]);
  });

  it("supports file-name, config-path, and command queries without demoting exact docs matches", async () => {
    const queries = [
      {
        query: "vite.config.ts",
        exactId: "chunk-file",
        broadId: "chunk-guide",
      },
      {
        query: "server.proxy",
        exactId: "chunk-config",
        broadId: "chunk-overview",
      },
      {
        query: "vite build",
        exactId: "chunk-command",
        broadId: "chunk-cli",
      },
    ] as const;

    for (const { query, exactId, broadId } of queries) {
      const result = await rerankCandidates(
        {
          originalQuery: query,
          rewrittenQuery: null,
          candidates: [
            makeCandidate(broadId, {
              content: "Broader Vite guide content.",
              matchedBy: ["vector_original"],
            }),
            makeCandidate(exactId, {
              content: `Direct documentation for ${query}.`,
              matchedBy: ["lexical_original"],
            }),
            makeCandidate("chunk-tail"),
          ],
          limit: 2,
        },
        rerankingConfig({ RERANKING_CANDIDATE_COUNT: "3" }),
        {
          rerankModel: vi.fn().mockResolvedValue(`{
            "rankedIds":["${exactId}","${broadId}","chunk-tail"]
          }`),
        },
      );

      expect(result.afterIds[0]).toBe(exactId);
    }
  });

  it("supports conversational questions by promoting the most answer-useful chunk", async () => {
    const result = await rerankCandidates(
      {
        originalQuery: "How do I configure a proxy for local API calls in Vite?",
        rewrittenQuery: "Vite dev server proxy server.proxy configuration",
        candidates: [
          makeCandidate("chunk-broad", {
            content: "General Vite configuration overview.",
            matchedBy: ["vector_original"],
          }),
          makeCandidate("chunk-answer", {
            title: "Server Options",
            url: "https://vite.dev/config/server-options",
            anchor: "server-proxy",
            content: "Configure local API forwarding with server.proxy in Vite dev server config.",
            matchedBy: ["vector_rewritten", "lexical_rewritten"],
          }),
          makeCandidate("chunk-secondary", {
            content: "Additional dev server notes.",
            matchedBy: ["vector_original"],
          }),
        ],
        limit: 2,
      },
      rerankingConfig({ RERANKING_CANDIDATE_COUNT: "3" }),
      {
        rerankModel: vi.fn().mockResolvedValue(`{
          "rankedIds":["chunk-answer","chunk-broad","chunk-secondary"],
          "diagnostics":[
            {"chunkId":"chunk-answer","score":0.96,"reason":"best direct answer"},
            {"chunkId":"chunk-broad","score":0.48,"reason":"background context"},
            {"chunkId":"chunk-secondary","score":0.32,"reason":"secondary support"}
          ]
        }`),
      },
    );

    expect(result.afterIds).toEqual(["chunk-answer", "chunk-broad"]);
    expect(result.candidates[0]?.matchedBy).toEqual(["vector_rewritten", "lexical_rewritten"]);
  });

  it("allows anchor-rich docs metadata to support final ordering decisions", async () => {
    const result = await rerankCandidates(
      {
        originalQuery: "VITE_",
        rewrittenQuery: null,
        candidates: [
          makeCandidate("chunk-no-anchor", {
            title: "Env Variables and Modes",
            url: "https://vite.dev/guide/env-and-mode",
            anchor: null,
            content: "Environment variables overview.",
            matchedBy: ["vector_original"],
          }),
          makeCandidate("chunk-anchor", {
            title: "Env Variables and Modes",
            url: "https://vite.dev/guide/env-and-mode",
            anchor: "env-variables",
            content: "Only variables prefixed with VITE_ are exposed to client code.",
            matchedBy: ["lexical_original"],
          }),
          makeCandidate("chunk-tail"),
        ],
        limit: 2,
      },
      rerankingConfig({ RERANKING_CANDIDATE_COUNT: "3" }),
      {
        rerankModel: vi.fn().mockResolvedValue(`{
          "rankedIds":["chunk-anchor","chunk-no-anchor","chunk-tail"]
        }`),
      },
    );

    expect(result.afterIds).toEqual(["chunk-anchor", "chunk-no-anchor"]);
  });

  it("allows near-duplicate candidate sets to prioritize more distinct useful evidence", async () => {
    const result = await rerankCandidates(
      {
        originalQuery: "What are Vite modes, and how do they affect .env file loading?",
        rewrittenQuery: "Vite modes env file loading",
        candidates: [
          makeCandidate("chunk-duplicate-a", {
            title: "Env Variables and Modes",
            url: "https://vite.dev/guide/env-and-mode",
            anchor: "modes",
            content: "Modes control which .env files are loaded in Vite.",
            matchedBy: ["vector_original"],
          }),
          makeCandidate("chunk-duplicate-b", {
            title: "Env Variables and Modes",
            url: "https://vite.dev/guide/env-and-mode",
            anchor: "modes",
            content: "Modes control which .env files are loaded in Vite, including mode-specific files.",
            matchedBy: ["vector_rewritten"],
          }),
          makeCandidate("chunk-distinct", {
            title: "Env Variables and Modes",
            url: "https://vite.dev/guide/env-and-mode",
            anchor: "env-files",
            content: ".env, .env.local, and mode-specific files are loaded in a defined priority order.",
            matchedBy: ["lexical_rewritten"],
          }),
        ],
        limit: 2,
      },
      rerankingConfig({ RERANKING_CANDIDATE_COUNT: "3" }),
      {
        rerankModel: vi.fn().mockResolvedValue(`{
          "rankedIds":["chunk-duplicate-a","chunk-distinct","chunk-duplicate-b"],
          "diagnostics":[
            {"chunkId":"chunk-duplicate-a","score":0.93,"reason":"strong primary answer chunk"},
            {"chunkId":"chunk-distinct","score":0.88,"reason":"adds distinct env-file loading detail"},
            {"chunkId":"chunk-duplicate-b","score":0.67,"reason":"near-duplicate of a higher-ranked chunk"}
          ]
        }`),
      },
    );

    expect(result.afterIds).toEqual(["chunk-duplicate-a", "chunk-distinct"]);
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
