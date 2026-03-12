# Retrieval Threshold Problem and Resolution Steps

## Problem Observed
From the fixed test set (`Q01`):

Question:
- "What is Vite, and what problem does it solve in frontend development?"

Observed behavior:
- Assistant returned fallback: "I don't know based on the indexed Vite documentation."
- Citations pointed to unrelated pages (backend integration, plugin API, environment API).

Interpretation:
- Retrieval returned chunks above threshold, but relevance quality was poor.
- The model followed grounding instructions and refused to answer from weak context.

## Why This Happens
- Retrieval threshold too low allows semantically weak matches.
- Weak matches contaminate chat context.
- Grounded prompt then correctly falls back even for answerable questions.

## Implemented Changes
- Retrieval thresholds are now configurable by environment variables:
  - `RETRIEVE_THRESHOLD_DEFAULT` for `/api/retrieve` default behavior
  - `CHAT_RETRIEVE_THRESHOLD` for `/api/chat` context retrieval
- Validation is applied:
  - range must be `0.0` to `1.0`
  - invalid values fall back to safe defaults

Defaults:
- `RETRIEVE_THRESHOLD_DEFAULT=0.55`
- `CHAT_RETRIEVE_THRESHOLD=0.6`

## What Each Threshold Controls

`RETRIEVE_THRESHOLD_DEFAULT`:
- Used by `POST /api/retrieve`.
- Purpose: debugging and direct retrieval inspection.
- If you call `/api/retrieve` without passing `threshold`, this is the value used.

`CHAT_RETRIEVE_THRESHOLD`:
- Used internally by `POST /api/chat`.
- Purpose: selecting context chunks before prompt construction.
- This has direct impact on final assistant answer quality and citations.

Core meaning (applies to both thresholds):
- Threshold controls how similar a chunk must be to the query to be included in retrieval results.
- Higher threshold = stricter similarity requirement (fewer chunks, usually higher precision).
- Lower threshold = looser similarity requirement (more chunks, usually higher recall but more noise).

Practical difference:
- `/api/retrieve` is mainly a diagnostic endpoint.
- `/api/chat` is the real user path.
- So if chat answers are noisy, tune `CHAT_RETRIEVE_THRESHOLD` first.

Request flow:
1. User asks question in chat.
2. `/api/chat` runs retrieval using `CHAT_RETRIEVE_THRESHOLD`.
3. Returned chunks become LLM context.
4. LLM answers only from that context.
5. If context is weak, fallback is likely.

When to tune which:
1. Tune `CHAT_RETRIEVE_THRESHOLD` when chat quality/citations are poor.
2. Tune `RETRIEVE_THRESHOLD_DEFAULT` when you are analyzing retrieval output directly via `/api/retrieve`.
3. Keep them close, but `CHAT_RETRIEVE_THRESHOLD` is often slightly higher to reduce noise in final answers.

## Tuning Steps (Repeatable)
1. Reingest data if content scope changed.
2. Run the fixed question set in `docs/TEST_QUESTION_SET.md`.
3. Track for each question:
   - answer correctness
   - citation relevance
   - fallback correctness
4. Adjust thresholds incrementally:
   - Increase by `+0.05` if citations are noisy/off-topic.
   - Decrease by `-0.05` if many answerable queries return fallback with no chunks.
5. Retest the same question set with unchanged wording.
6. Keep the smallest threshold values that:
   - improve citation relevance
   - preserve acceptable answer coverage

## Suggested Starting Range
- `CHAT_RETRIEVE_THRESHOLD`: `0.55` to `0.7`
- `RETRIEVE_THRESHOLD_DEFAULT`: `0.5` to `0.65`

## Example Resolution Workflow
1. Set:
   - `CHAT_RETRIEVE_THRESHOLD=0.6`
   - `RETRIEVE_THRESHOLD_DEFAULT=0.55`
2. Restart app.
3. Re-run `Q01` to check if citations include foundational Vite docs.
4. If still noisy, move `CHAT_RETRIEVE_THRESHOLD` to `0.65`.
5. If fallback becomes too frequent on in-scope questions, roll back by `0.05`.
