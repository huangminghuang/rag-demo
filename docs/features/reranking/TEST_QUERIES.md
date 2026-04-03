# Reranking Test Queries

Purpose: Repeatable checks for LLM reranking behavior over fused retrieval candidates, including exact-match protection, duplicate-sensitive ordering, reranking fallback behavior, and retrieve debug visibility.

Version: `v1`

## Usage Notes

- Enable reranking with the appropriate reranking environment flag before running these checks.
- Use `POST /api/retrieve` with `debug: true` so you can inspect reranking status, candidate counts, before/after order, and fallback reason when applicable.
- Compare reranking disabled vs enabled for the same query when verifying improvements or regressions.
- Keep the wording unchanged during evaluation.
- Run the relevant reranking-focused automated tests once they exist; use the matrix below for qualitative inspection against a running dataset until then.

## Test Matrix

| ID | Category | Expected Reranking Behavior | Query |
|---|---|---|---|
| RQ01 | exact identifier | preserve precise lexical hit near top | `import.meta.env` |
| RQ02 | exact identifier | preserve precise lexical hit near top | `VITE_` |
| RQ03 | exact config path | preserve exact config reference | `server.proxy` |
| RQ04 | exact config path | preserve exact config reference | `resolve.alias` |
| RQ05 | exact file name | preserve exact file-oriented result | `vite.config.ts` |
| RQ06 | exact command | preserve direct command documentation | `vite build` |
| RQ07 | exact command | preserve direct command documentation | `vite preview` |
| RQ08 | conversational | promote best answer-oriented chunk to top results | How do environment variables work in Vite, and what is the `VITE_` prefix for? |
| RQ09 | conversational | promote best answer-oriented chunk to top results | How do I configure a proxy for local API calls in Vite? |
| RQ10 | broad docs query | improve top-1/top-3 ordering without dropping relevant semantic coverage | How does Vite dependency pre-bundling work? |
| RQ11 | rewrite-assisted conversational | use original and rewritten intent without demoting exact terms | how env works in vite |
| RQ12 | rewrite-assisted conversational | use original and rewritten intent without demoting exact terms | how to deploy under subfolder in vite |
| RQ13 | duplicate-sensitive ranking | avoid spending multiple top slots on near-duplicate evidence when another result adds distinct value | What are Vite modes, and how do they affect `.env` file loading? |
| RQ14 | unsupported query | preserve stable fallback behavior when retrieval evidence is weak | Explain quantum error correction thresholds with current research citations. |

## Expected Reranking Characteristics

For exact technical lookups:

- the final top results should continue to favor chunks containing the exact identifier, path, file name, or command
- reranking should not demote precise lexical hits in favor of broader descriptive prose when the exact term is directly relevant
- docs-specific metadata such as title, URL, and anchor may help reinforce exactness

For conversational or broad queries:

- the final top result should better reflect answer usefulness than raw fused order alone
- rewritten-query context may help reranking when query rewrite applies
- reranking should improve or preserve top-1 and top-3 quality without breaking exact-match behavior elsewhere

For duplicate-sensitive candidate sets:

- near-duplicate chunks should not consume multiple top slots when another candidate contributes distinct useful evidence
- reranking should still keep the strongest single chunk high when it is clearly the best answer source

For fallback verification:

- with reranking disabled, results should follow the existing fused order
- on timeout, model failure, or invalid reranker output, the system should fall back to the fused order unchanged

## Suggested Manual Checks

### 1. Exact Technical Lookups

- Confirm exact identifiers, file names, config paths, and commands remain strong in the final order when reranking is enabled.
- Compare reranking enabled vs disabled and verify exact lexical hits do not drop behind generic prose.

### 2. Conversational Queries

- Confirm the final top-ranked chunk better matches the user’s actual question, not just broad topic overlap.
- Confirm rewritten-query cases still honor the original user intent.

### 3. Duplicate-Sensitive Ordering

- Inspect top results for redundant chunks from the same section.
- Confirm reranking can prefer a more diverse set of useful evidence when multiple candidates are near-duplicates.

### 4. Debug Visibility and Fallbacks

- Confirm retrieve debug output shows reranking applied/skipped/fallback status.
- Confirm before/after order is visible in debug mode only.
- Confirm fallback reason is visible when reranking cannot be applied successfully.

## Suggested Debug Request

```bash
curl -X POST http://localhost:3000/api/retrieve \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <csrf-token>" \
  -b "csrf_token=<csrf-cookie>; auth_session=<session-cookie>" \
  -d '{"query":"import.meta.env","limit":5,"debug":true}'
```
