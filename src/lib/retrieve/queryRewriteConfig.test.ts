import { describe, expect, it } from "vitest";
import { resolveQueryRewriteConfig } from "./queryRewriteConfig";

describe("resolveQueryRewriteConfig", () => {
  it("resolves query rewrite config with deterministic defaults", () => {
    expect(resolveQueryRewriteConfig({} as NodeJS.ProcessEnv)).toEqual({
      enabled: false,
      modelName: "gemini-2.5-flash",
      apiVersion: "v1beta",
      timeoutMs: 3000,
      maxRetries: 1,
      debug: false,
    });
  });

  it("uses explicit env overrides when provided", () => {
    expect(
      resolveQueryRewriteConfig({
        QUERY_REWRITE_ENABLED: "true",
        QUERY_REWRITE_MODEL_NAME: "rewrite-model",
        QUERY_REWRITE_MODEL_API_VERSION: "v1",
        QUERY_REWRITE_TIMEOUT_MS: "4500",
        QUERY_REWRITE_MAX_RETRIES: "0",
        QUERY_REWRITE_DEBUG: "true",
      } as NodeJS.ProcessEnv),
    ).toEqual({
      enabled: true,
      modelName: "rewrite-model",
      apiVersion: "v1",
      timeoutMs: 4500,
      maxRetries: 0,
      debug: true,
    });
  });

  it("rejects invalid timeout and retry values", () => {
    expect(() =>
      resolveQueryRewriteConfig({
        QUERY_REWRITE_TIMEOUT_MS: "0",
      } as NodeJS.ProcessEnv),
    ).toThrow("QUERY_REWRITE_TIMEOUT_MS must be a positive integer");

    expect(() =>
      resolveQueryRewriteConfig({
        QUERY_REWRITE_MAX_RETRIES: "-1",
      } as NodeJS.ProcessEnv),
    ).toThrow("QUERY_REWRITE_MAX_RETRIES must be a non-negative integer");
  });
});
