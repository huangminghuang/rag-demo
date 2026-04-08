# Ambiguity Gatekeeper for Chat Checklist Plan

## 1. Config and Rollout Controls
- [ ] Add ambiguity gatekeeper config resolution for enablement, timeout budget, API-key fallback, model selection, and debug logging.
- [ ] Add a master switch to enable or disable the gatekeeper globally.
- [ ] Keep the gatekeeper disabled by default for rollout safety.
- [ ] Add tests covering config defaults, validation, and API-key fallback behavior.

## 2. Deep Gatekeeper Module
- [ ] Add a dedicated gatekeeper module that encapsulates prompt construction, provider invocation, output parsing, validation, and fail-open behavior.
- [ ] Define a pluggable gatekeeper interface so chat orchestration stays provider-agnostic.
- [ ] Add a Gemini-backed phase-1 gatekeeper implementation behind that interface.
- [ ] Pass gatekeeper inputs including:
- [ ] original user message
- [ ] retained conversation history already prepared for chat
- [ ] Require structured decision output with:
- [ ] `decision`
- [ ] optional `reason`
- [ ] optional `clarificationQuestion`
- [ ] Add tests covering valid proceed behavior, valid clarification behavior, and deterministic fallback behavior.

## 3. Ambiguity Policy and Validation
- [ ] Treat malformed or incomplete gatekeeper outputs as fail-open to normal chat behavior.
- [ ] Fail open to the normal chat flow when the gatekeeper times out or errors.
- [ ] Keep the gatekeeper single-shot in phase 1 with no retry policy.
- [ ] Bias clarification toward genuinely underspecified requests rather than exact technical questions.
- [ ] Add tests covering timeout, model failure, malformed output, missing clarification question, and fail-open cases.

## 4. Chat Route Integration
- [ ] Integrate the gatekeeper into `POST /api/chat` before retrieval and answer generation.
- [ ] Skip `retrieveRelevantChunks(...)` when clarification is required.
- [ ] Skip `sendChatWithFallback(...)` when clarification is required.
- [ ] Keep the normal chat path unchanged when the gatekeeper decides to proceed.
- [ ] Return a stable clarification payload with empty sources when clarification is required.
- [ ] Add tests proving the gatekeeper changes only the chat route and leaves direct retrieval unchanged.

## 5. Ambiguity and Context Behavior
- [ ] Ask one targeted clarifying question for broad underspecified requests.
- [ ] Avoid clarifying already-specific exact identifiers, config paths, file names, and commands.
- [ ] Allow retained conversation history to disambiguate short follow-up questions when context makes them clear.
- [ ] Avoid multi-question or open-ended clarification responses in phase 1.
- [ ] Add tests covering:
- [ ] broad ambiguous questions
- [ ] exact identifiers
- [ ] config paths
- [ ] file names
- [ ] CLI commands
- [ ] history-aware follow-up questions

## 6. Response Contract and Debug Boundaries
- [ ] Keep the existing chat response shape unchanged for normal non-ambiguous answers.
- [ ] Add a stable clarification response contract for ambiguous requests.
- [ ] Keep gatekeeper diagnostics internal to server logs in phase 1 rather than exposing a chat debug payload.
- [ ] Keep `POST /api/retrieve` non-interactive and unchanged in phase 1.
- [ ] Add tests covering normal response shape stability, clarification response shape, and retrieve-route non-impact.

## 7. Documentation and Verification
- [ ] Document all ambiguity-gatekeeper environment variables in `README.md`.
- [ ] Document how the gatekeeper composes with retrieval, query rewrite, hybrid retrieval, and reranking.
- [ ] Document that the gatekeeper applies only to `POST /api/chat` in phase 1.
- [ ] Document the fail-open behavior for timeout, model failure, and malformed output.
- [ ] Add a gatekeeper test query set in `docs/features/ambiguity-gatekeeper`.
- [ ] Add manual verification guidance for:
- [ ] ambiguous questions that should trigger clarification
- [ ] specific questions that should proceed directly
- [ ] history-aware follow-up questions
- [ ] fallback behavior when the gatekeeper cannot decide cleanly

## 8. Evaluation and Acceptance
- [ ] Add automated coverage proving ambiguous chat requests ask for clarification instead of retrieving and answering immediately.
- [ ] Confirm specific documentation questions are not degraded by over-triggered clarification.
- [ ] Confirm exact identifiers, file names, config paths, and commands proceed normally.
- [ ] Confirm short follow-up questions can still proceed when recent history makes them clear.
- [ ] Confirm gatekeeper failures do not break normal chat behavior.
- [ ] Confirm chat clarification responses return empty sources and skip downstream retrieval/generation work.
- [ ] Confirm `POST /api/retrieve` remains stable and non-interactive.
