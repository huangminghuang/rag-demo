import { describe, expect, it } from "vitest";
import { decideQueryRewriteEligibility } from "./queryRewrite";
import { resolveQueryRewriteConfig } from "./queryRewriteConfig";

describe("decideQueryRewriteEligibility", () => {
  it("returns disabled when the master switch is off", () => {
    const config = resolveQueryRewriteConfig({
      QUERY_REWRITE_ENABLED: "false",
    } as NodeJS.ProcessEnv);

    expect(decideQueryRewriteEligibility("How do env vars work in Vite?", config)).toEqual({
      eligible: false,
      normalizedQuery: "How do env vars work in Vite?",
      reason: "disabled",
    });
  });

  it("marks conversational Vite questions as eligible", () => {
    const config = resolveQueryRewriteConfig({
      QUERY_REWRITE_ENABLED: "true",
    } as NodeJS.ProcessEnv);

    expect(
      decideQueryRewriteEligibility(
        "How do environment variables work in Vite, and what is the VITE_ prefix for?",
        config,
      ),
    ).toEqual({
      eligible: true,
      normalizedQuery: "How do environment variables work in Vite, and what is the VITE_ prefix for?",
      reason: "eligible",
    });
  });

  it("skips identifier-like exact queries", () => {
    const config = resolveQueryRewriteConfig({
      QUERY_REWRITE_ENABLED: "true",
    } as NodeJS.ProcessEnv);

    expect(decideQueryRewriteEligibility("import.meta.env", config)).toEqual({
      eligible: false,
      normalizedQuery: "import.meta.env",
      reason: "identifier_like",
    });
  });

  it("skips quoted exact queries", () => {
    const config = resolveQueryRewriteConfig({
      QUERY_REWRITE_ENABLED: "true",
    } as NodeJS.ProcessEnv);

    expect(decideQueryRewriteEligibility("\"VITE_ prefix\"", config)).toEqual({
      eligible: false,
      normalizedQuery: "\"VITE_ prefix\"",
      reason: "quoted_query",
    });

    expect(decideQueryRewriteEligibility("\"VITE_\" prefix", config)).toEqual({
      eligible: false,
      normalizedQuery: "\"VITE_\" prefix",
      reason: "quoted_query",
    });
  });

  it("skips context-dependent follow-up queries", () => {
    const config = resolveQueryRewriteConfig({
      QUERY_REWRITE_ENABLED: "true",
    } as NodeJS.ProcessEnv);

    expect(decideQueryRewriteEligibility("what about in SSR?", config)).toEqual({
      eligible: false,
      normalizedQuery: "what about in SSR?",
      reason: "context_dependent",
    });
  });

  it("skips very short and very long queries", () => {
    const config = resolveQueryRewriteConfig({
      QUERY_REWRITE_ENABLED: "true",
    } as NodeJS.ProcessEnv);

    expect(decideQueryRewriteEligibility("vite", config)).toEqual({
      eligible: false,
      normalizedQuery: "vite",
      reason: "query_too_short",
    });

    expect(
      decideQueryRewriteEligibility(
        "Can you explain in detail how Vite handles environment variables across different modes, how .env, .env.local, .env.production, and .env.development files interact, which variables are exposed to client code, and how this compares to traditional bundlers?",
        config,
      ),
    ).toEqual({
      eligible: false,
      normalizedQuery:
        "Can you explain in detail how Vite handles environment variables across different modes, how .env, .env.local, .env.production, and .env.development files interact, which variables are exposed to client code, and how this compares to traditional bundlers?",
      reason: "query_too_long",
    });
  });

  it("skips exact command queries", () => {
    const config = resolveQueryRewriteConfig({
      QUERY_REWRITE_ENABLED: "true",
    } as NodeJS.ProcessEnv);

    expect(decideQueryRewriteEligibility("vite build", config)).toEqual({
      eligible: false,
      normalizedQuery: "vite build",
      reason: "identifier_like",
    });

    expect(decideQueryRewriteEligibility("vite preview", config)).toEqual({
      eligible: false,
      normalizedQuery: "vite preview",
      reason: "identifier_like",
    });
  });
});
