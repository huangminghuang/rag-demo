// Build the prompt used to rewrite a user query into a retrieval-friendly Vite docs search query.
export function buildQueryRewritePrompt(query: string): string {
  return [
    "You are rewriting questions for retrieval from Vite documentation.",
    "Rewrite the user's question into one concise, keyword-rich search query for documentation retrieval.",
    "Preserve the exact intent.",
    "Do not answer the question.",
    "Prefer official Vite terminology, config names, CLI terms, plugin terms, environment variable terms, and build/dev terminology when relevant.",
    "Add closely related synonyms only if they improve recall.",
    "Keep the rewritten query short and retrieval-friendly.",
    "Output only the rewritten query.",
    "",
    "User question:",
    query,
  ].join("\n");
}
