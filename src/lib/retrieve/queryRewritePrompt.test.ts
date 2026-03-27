import { describe, expect, it } from "vitest";
import { buildQueryRewritePrompt } from "./queryRewritePrompt";

describe("buildQueryRewritePrompt", () => {
  it("builds a Vite-aware rewrite prompt that asks for one keyword-rich query", () => {
    const prompt = buildQueryRewritePrompt(
      "How do environment variables work in Vite, and what is the VITE_ prefix for?",
    );

    expect(prompt).toContain("You are rewriting questions for retrieval from Vite documentation.");
    expect(prompt).toContain("Output only the rewritten query.");
    expect(prompt).toContain("User question:");
    expect(prompt).toContain("VITE_ prefix");
  });
});
