import { describe, expect, it } from "vitest";
import { decideQueryRewriteEligibility } from "./queryRewrite";
import { resolveQueryRewriteConfig } from "./queryRewriteConfig";
import { loadDocumentedQueryRewriteMatrix } from "./queryRewriteTestMatrix";

describe("documented query rewrite matrix", () => {
  const config = resolveQueryRewriteConfig({
    QUERY_REWRITE_ENABLED: "true",
  } as NodeJS.ProcessEnv);
  const matrixCases = loadDocumentedQueryRewriteMatrix();

  it("loads the documented query matrix", () => {
    expect(matrixCases.length).toBeGreaterThan(0);
  });

  it.each(matrixCases)("$id keeps $category behavior aligned with the docs", ({ query, expectedEligibility }) => {
    expect(decideQueryRewriteEligibility(query, config)).toEqual({
      eligible: expectedEligibility.eligible,
      normalizedQuery: query,
      reason: expectedEligibility.reason,
    });
  });
});
