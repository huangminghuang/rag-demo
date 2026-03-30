import { describe, expect, it } from "vitest";
import { resolveHybridRetrievalConfig } from "./hybridRetrievalConfig";

describe("resolveHybridRetrievalConfig", () => {
  it("resolves hybrid retrieval config with deterministic defaults", () => {
    expect(resolveHybridRetrievalConfig({} as NodeJS.ProcessEnv)).toEqual({
      enabled: false,
      trigramThreshold: 0.18,
      preFusionLimit: 12,
      debug: false,
    });
  });

  it("uses explicit env overrides when provided", () => {
    expect(
      resolveHybridRetrievalConfig({
        HYBRID_RETRIEVAL_ENABLED: "true",
        HYBRID_LEXICAL_TRIGRAM_THRESHOLD: "0.25",
        HYBRID_PRE_FUSION_LIMIT: "16",
        HYBRID_RETRIEVAL_DEBUG: "true",
      } as NodeJS.ProcessEnv),
    ).toEqual({
      enabled: true,
      trigramThreshold: 0.25,
      preFusionLimit: 16,
      debug: true,
    });
  });

  it("rejects invalid trigram threshold and pre-fusion limit values", () => {
    expect(() =>
      resolveHybridRetrievalConfig({
        HYBRID_LEXICAL_TRIGRAM_THRESHOLD: "0",
      } as NodeJS.ProcessEnv),
    ).toThrow("HYBRID_LEXICAL_TRIGRAM_THRESHOLD must be a number between 0 and 1");

    expect(() =>
      resolveHybridRetrievalConfig({
        HYBRID_LEXICAL_TRIGRAM_THRESHOLD: "1.1",
      } as NodeJS.ProcessEnv),
    ).toThrow("HYBRID_LEXICAL_TRIGRAM_THRESHOLD must be a number between 0 and 1");

    expect(() =>
      resolveHybridRetrievalConfig({
        HYBRID_PRE_FUSION_LIMIT: "0",
      } as NodeJS.ProcessEnv),
    ).toThrow("HYBRID_PRE_FUSION_LIMIT must be a positive integer");
  });
});
