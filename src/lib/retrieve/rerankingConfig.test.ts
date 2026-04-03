import { describe, expect, it } from "vitest";
import { resolveRerankingConfig } from "./rerankingConfig";

function asProcessEnv(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as unknown as NodeJS.ProcessEnv;
}

describe("resolveRerankingConfig", () => {
  it("resolves reranking config with deterministic defaults", () => {
    expect(resolveRerankingConfig({} as NodeJS.ProcessEnv)).toEqual({
      enabled: false,
      candidateCount: 10,
      timeoutMs: 2500,
      debug: false,
    });
  });

  it("uses explicit env overrides when provided", () => {
    expect(
      resolveRerankingConfig(asProcessEnv({
        RERANKING_ENABLED: "true",
        RERANKING_CANDIDATE_COUNT: "12",
        RERANKING_TIMEOUT_MS: "4000",
        RERANKING_DEBUG: "true",
      })),
    ).toEqual({
      enabled: true,
      candidateCount: 12,
      timeoutMs: 4000,
      debug: true,
    });
  });

  it("rejects invalid candidate-count and timeout values", () => {
    expect(() =>
      resolveRerankingConfig(asProcessEnv({
        RERANKING_CANDIDATE_COUNT: "0",
      })),
    ).toThrow("RERANKING_CANDIDATE_COUNT must be a positive integer");

    expect(() =>
      resolveRerankingConfig(asProcessEnv({
        RERANKING_TIMEOUT_MS: "-1",
      })),
    ).toThrow("RERANKING_TIMEOUT_MS must be a positive integer");
  });
});
