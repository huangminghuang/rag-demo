import { describe, expect, it, vi } from "vitest";
import {
  combineLexicalScores,
  rankLexicalSearchRows,
  searchChunksLexically,
} from "./lexicalSearch";

describe("lexicalSearch", () => {
  it("prefers strong FTS matches for natural-language lexical queries", async () => {
    const executeLexicalSearch = vi.fn().mockResolvedValue([
      {
        chunkId: "chunk-fts",
        content: "Configure the Vite dev server proxy for local API calls.",
        url: "https://vite.dev/config/server-options",
        title: "Server Options",
        anchor: "server-proxy",
        ftsScore: 0.9,
        trigramScore: 0.05,
      },
      {
        chunkId: "chunk-trigram",
        content: "proxy",
        url: "https://vite.dev/guide/backend-integration",
        title: "Backend Integration",
        anchor: null,
        ftsScore: 0,
        trigramScore: 0.4,
      },
    ]);

    const results = await searchChunksLexically(
      "how to configure proxy in vite",
      { limit: 2, trigramThreshold: 0.18 },
      { executeLexicalSearch },
    );

    expect(results.map((result) => result.chunkId)).toEqual(["chunk-fts", "chunk-trigram"]);
    expect(results[0]?.url).toBe("https://vite.dev/config/server-options#server-proxy");
  });

  it("keeps identifier-heavy exact queries through trigram support", async () => {
    const executeLexicalSearch = vi.fn().mockResolvedValue([
      {
        chunkId: "chunk-identifier",
        content: "Use import.meta.env to access exposed Vite environment variables.",
        url: "https://vite.dev/guide/env-and-mode",
        title: "Env Variables and Modes",
        anchor: null,
        ftsScore: 0,
        trigramScore: 0.42,
      },
    ]);

    const results = await searchChunksLexically(
      "import.meta.env",
      { limit: 5, trigramThreshold: 0.18 },
      { executeLexicalSearch },
    );

    expect(results).toEqual([
      {
        chunkId: "chunk-identifier",
        content: "Use import.meta.env to access exposed Vite environment variables.",
        url: "https://vite.dev/guide/env-and-mode",
        title: "Env Variables and Modes",
        anchor: null,
        similarity: combineLexicalScores({ ftsScore: 0, trigramScore: 0.42 }),
      },
    ]);
  });

  it("combines FTS and trigram evidence into one lexical branch score", () => {
    const results = rankLexicalSearchRows(
      [
        {
          chunkId: "chunk-both",
          content: "server.proxy config",
          url: "https://vite.dev/config/server-options",
          title: "Server Options",
          anchor: null,
          ftsScore: 0.6,
          trigramScore: 0.4,
        },
        {
          chunkId: "chunk-fts-only",
          content: "proxy setup",
          url: "https://vite.dev/guide/backend-integration",
          title: "Backend Integration",
          anchor: null,
          ftsScore: 0.55,
          trigramScore: 0,
        },
      ],
      { limit: 5, trigramThreshold: 0.18 },
    );

    expect(results.map((result) => result.chunkId)).toEqual(["chunk-both", "chunk-fts-only"]);
  });

  it("drops rows that miss both the FTS and trigram thresholds", () => {
    const results = rankLexicalSearchRows(
      [
        {
          chunkId: "chunk-noise",
          content: "Unrelated content",
          url: "https://vite.dev/guide/assets",
          title: "Assets",
          anchor: null,
          ftsScore: 0,
          trigramScore: 0.17,
        },
      ],
      { limit: 5, trigramThreshold: 0.18 },
    );

    expect(results).toEqual([]);
  });
});
