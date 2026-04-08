# Ambiguity Gatekeeper for Chat Checklist Plan

## 1. Config and Rollout Controls
- [x] Add ambiguity gatekeeper config resolution for enablement, timeout budget, API-key fallback, model selection, and debug logging.
- [x] Add a master switch to enable or disable the gatekeeper globally.
- [x] Keep the gatekeeper disabled by default for rollout safety.
- [x] Add tests covering config defaults, validation, and API-key fallback behavior.

## 2. Deep Gatekeeper Module
- [x] Add a dedicated gatekeeper module that encapsulates prompt construction, provider invocation, output parsing, validation, and fail-open behavior.
- [x] Define a pluggable gatekeeper interface so chat orchestration stays provider-agnostic.
- [x] Add a Gemini-backed phase-1 gatekeeper implementation behind that interface.
- [x] Pass gatekeeper inputs including:
- [x] original user message
- [x] retained conversation history already prepared for chat
- [x] Require structured decision output with:
- [x] `decision`
- [x] optional `reason`
- [x] optional `clarificationQuestion`
- [x] Add tests covering valid proceed behavior, valid clarification behavior, and deterministic fallback behavior.

## 3. Ambiguity Policy and Validation
- [x] Treat malformed or incomplete gatekeeper outputs as fail-open to normal chat behavior.
- [x] Fail open to the normal chat flow when the gatekeeper times out or errors.
- [x] Keep the gatekeeper single-shot in phase 1 with no retry policy.
- [x] Bias clarification toward genuinely underspecified requests rather than exact technical questions.
- [x] Add tests covering timeout, model failure, malformed output, missing clarification question, and fail-open cases.

## 4. Chat Route Integration
- [x] Integrate the gatekeeper into `POST /api/chat` before retrieval and answer generation.
- [x] Skip `retrieveRelevantChunks(...)` when clarification is required.
- [x] Skip `sendChatWithFallback(...)` when clarification is required.
- [x] Keep the normal chat path unchanged when the gatekeeper decides to proceed.
- [x] Return a stable clarification payload with empty sources when clarification is required.
- [x] Add tests proving the gatekeeper changes only the chat route and leaves direct retrieval unchanged.

## 5. Ambiguity and Context Behavior
- [x] Ask one targeted clarifying question for broad underspecified requests.
- [x] Avoid clarifying already-specific exact identifiers, config paths, file names, and commands.
- [x] Allow retained conversation history to disambiguate short follow-up questions when context makes them clear.
- [x] Avoid multi-question or open-ended clarification responses in phase 1.
- [x] Add tests covering:
- [x] broad ambiguous questions
- [x] exact identifiers
- [x] config paths
- [x] file names
- [x] CLI commands
- [x] history-aware follow-up questions

## 6. Response Contract and Debug Boundaries
- [x] Keep the existing chat response shape unchanged for normal non-ambiguous answers.
- [x] Add a stable clarification response contract for ambiguous requests.
- [x] Keep gatekeeper diagnostics internal to server logs in phase 1 rather than exposing a chat debug payload.
- [x] Keep `POST /api/retrieve` non-interactive and unchanged in phase 1.
- [x] Add tests covering normal response shape stability, clarification response shape, and retrieve-route non-impact.

## 7. Documentation and Verification
- [x] Document all ambiguity-gatekeeper environment variables in `README.md`.
- [x] Document how the gatekeeper composes with retrieval, query rewrite, hybrid retrieval, and reranking.
- [x] Document that the gatekeeper applies only to `POST /api/chat` in phase 1.
- [x] Document the fail-open behavior for timeout, model failure, and malformed output.
- [x] Add a gatekeeper test query set in `docs/features/ambiguity-gatekeeper`.
- [x] Add manual verification guidance for:
- [x] ambiguous questions that should trigger clarification
- [x] specific questions that should proceed directly
- [x] history-aware follow-up questions
- [x] fallback behavior when the gatekeeper cannot decide cleanly

## 8. Evaluation and Acceptance
- [x] Add automated coverage proving ambiguous chat requests ask for clarification instead of retrieving and answering immediately.
- [x] Confirm specific documentation questions are not degraded by over-triggered clarification.
- [x] Confirm exact identifiers, file names, config paths, and commands proceed normally.
- [x] Confirm short follow-up questions can still proceed when recent history makes them clear.
- [x] Confirm gatekeeper failures do not break normal chat behavior.
- [x] Confirm chat clarification responses return empty sources and skip downstream retrieval/generation work.
- [x] Confirm `POST /api/retrieve` remains stable and non-interactive.
