# Query Rewrite Test Queries

Purpose: Repeatable checks for query-rewrite gating, rewrite quality, and dual-retrieval fusion behavior.

Version: `v1`

## Usage Notes

- Use these queries with query rewrite disabled first, then enabled.
- For `POST /api/retrieve`, prefer using the explicit debug flag so you can inspect:
  - `rewriteApplied`
  - `rewriteReason`
  - `rewrittenQuery`
  - branch counts
  - per-result `matchedBy`
- Keep the wording unchanged during evaluation.
- Compare:
  - whether rewrite was correctly applied or skipped
  - whether the rewritten query stayed faithful to the original intent
  - whether rewritten-branch hits improved recall without displacing strong exact matches

## Test Matrix

| ID | Category | Expected Rewrite | Query |
|---|---|---|---|
| RQ01 | conversational | apply | How do environment variables work in Vite, and what is the `VITE_` prefix for? |
| RQ02 | conversational | apply | How do I set up path aliases in Vite? |
| RQ03 | conversational | apply | How do I configure a proxy for local API calls in Vite? |
| RQ04 | conversational | apply | What is `defineConfig` and why should I use it? |
| RQ05 | short natural language | apply | how env works in vite |
| RQ06 | short natural language | apply | how to deploy under subfolder in vite |
| RQ07 | exact identifier | skip `identifier_like` | `import.meta.env` |
| RQ08 | exact identifier | skip `identifier_like` | `VITE_` |
| RQ09 | exact identifier | skip `identifier_like` | `defineConfig` |
| RQ10 | exact config path | skip `identifier_like` | `server.proxy` |
| RQ11 | exact config path | skip `identifier_like` | `optimizeDeps` |
| RQ12 | exact file name | skip `identifier_like` | `vite.config.ts` |
| RQ13 | quoted exact query | skip `quoted_query` | `"import.meta.env"` |
| RQ14 | quoted exact query | skip `quoted_query` | `"VITE_" prefix` |
| RQ15 | context dependent follow-up | skip `context_dependent` | what about in SSR? |
| RQ16 | context dependent follow-up | skip `context_dependent` | how does that work there? |
| RQ17 | very long query | skip `query_too_long` | Can you explain in detail how Vite handles environment variables across different modes, how `.env`, `.env.local`, `.env.production`, and `.env.development` files interact, which variables are exposed to client code, and how this compares to traditional bundlers? |
| RQ18 | exact command | skip `identifier_like` | `vite build` |
| RQ19 | exact command | skip `identifier_like` | `vite preview` |
| RQ20 | broad docs query | apply | How does Vite dependency pre-bundling work? |

## Expected Rewrite Characteristics

For queries where rewrite should apply:

- The rewritten query should stay close to the original meaning.
- The rewritten query should be keyword-rich rather than conversational.
- The rewritten query should prefer Vite terminology such as:
  - `import.meta.env`
  - `env files`
  - `modes`
  - `vite.config`
  - `server.proxy`
  - `optimizeDeps`
  - `base path`
  - `path alias`
- The rewritten query should not answer the question.
- The rewritten query should not introduce unsupported concepts.

For queries where rewrite should skip:

- `rewriteApplied` should be `false`
- `rewriteReason` should match the expected category in the table above
- `rewrittenQuery` should be `null`

## Suggested Manual Checks

### 1. Rewrite Gating

- Confirm identifier-like queries are skipped.
- Confirm quoted queries are skipped.
- Confirm context-dependent follow-ups are skipped.
- Confirm natural-language questions are rewritten.

### 2. Rewrite Quality

- Confirm rewritten queries are shorter and more retrieval-friendly than the original wording.
- Confirm rewritten queries preserve user intent.
- Confirm rewritten queries use Vite-specific terminology when appropriate.

### 3. Fusion Quality

- Confirm exact-match queries still return strong original-branch hits.
- Confirm conversational queries can surface `rewritten` or `both` provenance hits.
- Confirm rewritten-only hits improve recall rather than replacing obviously relevant exact hits.

## Suggested Debug Request

```bash
curl -X POST http://localhost:3000/api/retrieve \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <csrf-token>" \
  -b "csrf_token=<csrf-cookie>; auth_session=<session-cookie>" \
  -d '{"query":"How do environment variables work in Vite, and what is the VITE_ prefix for?","limit":5,"debug":true}'
```
