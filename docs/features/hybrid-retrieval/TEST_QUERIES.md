# Hybrid Retrieval Test Queries

Purpose: Repeatable checks for lexical + vector retrieval behavior, hybrid debug visibility, and hybrid/query-rewrite composition.

Version: `v1`

## Usage Notes

- Run `npm run test:hybrid-retrieval` to execute the automated hybrid-retrieval suite.
- Enable hybrid retrieval with `HYBRID_RETRIEVAL_ENABLED=true` before running these checks.
- Use `POST /api/retrieve` with `debug: true` so you can inspect:
  - `branchCounts`
  - `originalBranchCount`
  - `rewrittenBranchCount`
  - per-result `matchedBy`
- Compare hybrid retrieval disabled vs enabled for the same query when verifying improvements.
- Keep the wording unchanged during evaluation.

The automated suite covers lexical/vector branch behavior, shared-boundary integration, retrieve debug visibility, and route-level API stability. The matrix below remains useful for qualitative inspection against a running dataset.

## Test Matrix

| ID | Category | Expected Dominant Signal | Query |
|---|---|---|---|
| HQ01 | exact identifier | lexical | `import.meta.env` |
| HQ02 | exact identifier | lexical | `VITE_` |
| HQ03 | exact config path | lexical | `server.proxy` |
| HQ04 | exact config path | lexical | `optimizeDeps` |
| HQ05 | exact file name | lexical | `vite.config.ts` |
| HQ06 | exact command | lexical | `vite build` |
| HQ07 | exact command | lexical | `vite preview` |
| HQ08 | short technical noun phrase | lexical or both | `path aliases` |
| HQ09 | conversational | vector or both | How do environment variables work in Vite, and what is the `VITE_` prefix for? |
| HQ10 | conversational | vector or both | How do I configure a proxy for local API calls in Vite? |
| HQ11 | broad docs query | vector or both | How does Vite dependency pre-bundling work? |
| HQ12 | rewrite-assisted lexical | rewritten lexical or both | how env works in vite |
| HQ13 | rewrite-assisted lexical | rewritten lexical or both | how to deploy under subfolder in vite |
| HQ14 | hybrid disabled fallback | vector only | How do I set up path aliases in Vite? |

## Expected Hybrid Characteristics

For lexical-dominant queries:

- `matchedBy` should usually include `lexical_original`.
- Exact technical queries should not depend on rewritten branches.
- Results containing the exact identifier, path, file name, or command should rank strongly.

For conversational or broad queries:

- `matchedBy` should usually include `vector_original`, `vector_rewritten`, or both.
- `lexical_rewritten` may appear when query rewrite introduces stronger technical terms.
- Hybrid retrieval should improve or preserve recall without displacing obviously relevant semantic hits.

For fallback verification:

- With `HYBRID_RETRIEVAL_ENABLED=false`, lexical branches should disappear from `branchCounts`.
- The retrieval pipeline should fall back to the prior vector-only behavior.

## Suggested Manual Checks

### 1. Exact Technical Lookups

- Confirm identifier-style queries surface lexical matches through `lexical_original`.
- Confirm file names, config paths, and commands remain precise under hybrid retrieval.

### 2. Conversational Queries

- Confirm conversational questions still return strong vector matches.
- Confirm rewritten-query branches can contribute to hybrid results when rewrite is enabled.

### 3. Debug Visibility

- Confirm `branchCounts` accurately reflects which hybrid branches ran.
- Confirm per-result `matchedBy` lists make branch provenance inspectable.

## Suggested Debug Request

```bash
curl -X POST http://localhost:3000/api/retrieve \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <csrf-token>" \
  -b "csrf_token=<csrf-cookie>; auth_session=<session-cookie>" \
  -d '{"query":"import.meta.env","limit":5,"debug":true}'
```
