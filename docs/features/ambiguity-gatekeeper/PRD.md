# Ambiguity Gatekeeper for Chat PRD

## Problem Statement

The current chat flow always attempts retrieval and answer generation for the latest user message. This works well for clear, documentation-grounded questions, but it handles ambiguous requests poorly.

This creates predictable failure modes:

- vague questions such as "How is Vite doing?" or "Can you explain this config?" do not provide enough intent to retrieve the best documentation evidence
- the model may produce a broad or low-confidence answer when it should first ask what aspect the user actually cares about
- retrieval, query rewrite, hybrid retrieval, and reranking are all downstream quality layers, but none of them are designed to stop and request clarification when the user’s question is underspecified
- chat currently has no explicit front-door decision point for "ask a clarifying question" versus "retrieve and answer now"
- ambiguous follow-up messages can be especially hard to interpret without a bounded contract for when the system should pause and disambiguate

The user wants a gatekeeper stage inspired by the "Gatekeeper Node for Ambiguity Detection" pattern described in the external `agentic-rag` reference, adapted to this repository’s architecture so chat asks one targeted clarifying question when the latest request is too ambiguous to answer well.

## Solution

Add an ambiguity gatekeeper layer to `POST /api/chat` before retrieval and answer generation.

The system will:

- evaluate the latest user message before running retrieval
- consider the retained conversation history already prepared for chat when deciding whether the latest message is clear enough
- use a bounded ambiguity-check contract that returns either:
- proceed without clarification
- ask one focused clarifying question
- skip retrieval and answer generation when clarification is required
- keep the ambiguity gate lightweight and single-shot in phase 1
- gate the feature behind environment-backed rollout controls
- keep direct retrieval non-interactive in phase 1 and limit gatekeeper behavior to chat
- preserve the normal chat response shape for non-ambiguous requests
- return a stable clarifying-response shape for ambiguous requests

The initial rollout will:

- use a small Gemini-backed gatekeeper model call with a dedicated prompt and structured output
- keep the feature disabled by default for rollout safety
- avoid planner-style multi-step orchestration in phase 1
- ask for at most one clarification question per ambiguous request
- avoid storing new schema-level clarification state in phase 1

## User Stories

1. As a user asking a vague question, I want the assistant to ask what I mean before answering, so that I get a more relevant result.
2. As a user asking a clear documentation question, I want chat to proceed normally without unnecessary friction, so that the feature does not slow down obvious requests.
3. As a user continuing a conversation, I want the assistant to use prior turns when deciding if my latest message is ambiguous, so that concise follow-up questions can still work when context makes them clear.
4. As a maintainer of retrieval quality, I want ambiguity detection to happen before retrieval, so that downstream ranking layers are not forced to answer underspecified questions.
5. As a maintainer of routing consistency, I want direct retrieval to remain non-interactive in phase 1, so that only chat becomes clarification-aware.
6. As a maintainer of system stability, I want ambiguous requests to short-circuit cleanly before retrieval and generation, so that the system avoids unnecessary model and embedding work.
7. As a maintainer of observability, I want explicit gatekeeper decisions and reasons available through controlled debugging, so that rollout behavior is inspectable.
8. As a test author, I want the gatekeeper decision layer tested independently from route plumbing, so that ambiguity policy can evolve safely.
9. As a test author, I want chat route tests to prove retrieval is skipped when clarification is required, so that the route contract stays clear.
10. As a product owner, I want the feature rollout-gated and disabled by default, so that ambiguity policy can be tuned without destabilizing normal chat behavior.

## Implementation Decisions

- Implement the ambiguity gatekeeper inside `POST /api/chat` before `retrieveRelevantChunks(...)` is called.
- Limit ambiguity detection to chat in phase 1; `POST /api/retrieve` remains a direct retrieval API and does not ask clarifying questions.
- Reuse the retained conversation history already prepared in the chat route as supporting context for the ambiguity decision.
- Introduce a dedicated ambiguity gatekeeper module that owns:
- prompt construction
- provider invocation
- structured output parsing
- decision validation
- fail-open behavior
- Use a pluggable gatekeeper interface so route orchestration stays provider-agnostic.
- Use the existing Gemini stack as the first ambiguity-gatekeeper implementation in phase 1.
- Add an ambiguity gatekeeper config module with:
- a master enable flag
- timeout budget
- debug logging control
- optional dedicated API key and model selection
- Require a structured output contract that returns:
- `decision: "proceed" | "clarify"`
- optional short `reason`
- optional `clarificationQuestion`
- Treat malformed output, timeout, or model failure as fail-open to normal chat behavior rather than blocking the user.
- Keep the gatekeeper single-shot in phase 1 with no retry policy.
- When the gatekeeper returns `clarify`, skip retrieval, skip quota consumption for retrieval/generation work, and skip `sendChatWithFallback(...)`.
- Return a stable chat clarification payload in phase 1:
- `content`: the clarifying question text
- `sources`: an empty array
- `needsClarification: true`
- `clarificationReason`: optional debug-safe summary if included by the gatekeeper contract
- For normal non-ambiguous requests, keep the existing chat response shape unchanged unless the user explicitly opts into later debug behavior.
- Keep gatekeeper diagnostics internal to server logs in phase 1 rather than exposing a full debug payload from chat.
- Prefer ambiguity checks for broad underspecified requests such as:
- unspecified topic dimensions
- unclear pronoun references without enough context
- broad "how is X doing" style questions
- Do not ask clarifying questions when the request is already sufficiently specific, especially for:
- exact identifiers
- config paths
- file names
- CLI commands
- well-scoped natural-language questions
- context-dependent follow-up questions that become clear when recent chat history is considered

## Testing Decisions

- A good ambiguity-gatekeeper test should validate user-visible routing behavior rather than prompt wording.
- Config should be tested for deterministic defaults and validation behavior.
- The gatekeeper module should be tested for:
- clear proceed decisions
- clarification decisions with one returned question
- history-aware disambiguation support
- fail-open behavior on timeout, model failure, and malformed output
- stable handling of exact identifiers and other already-specific queries
- Chat integration should be tested to confirm:
- retrieval is skipped when clarification is required
- answer generation is skipped when clarification is required
- normal chat flow is unchanged when the gatekeeper decides to proceed
- clarification responses return `sources: []`
- direct retrieval remains unchanged and non-interactive
- Acceptance coverage should include:
- broad ambiguous questions
- specific documentation questions
- exact identifiers
- config paths
- short follow-up turns that are clear only with retained history
- malformed-output and timeout fallback cases

## Out of Scope

- Multi-turn planner workflows or tool-routing orchestration.
- Persisting clarification state outside the request/response cycle in phase 1.
- Interactive clarification behavior for `POST /api/retrieve`.
- Multiple clarification questions in one response.
- Confidence-scored answer refusal logic beyond ambiguity detection.
- UI-specific rendering changes beyond supporting the returned chat payload.
- Live-service evaluation as part of the initial rollout.

## Further Notes

- The external `agentic-rag` reference uses a gatekeeper node that either proceeds or asks for clarification; this repository should adopt that core behavior, but adapt it to the existing chat route rather than importing the surrounding planner graph wholesale.
- The main product risk is over-triggering clarification and making chat feel slower or more obstructive for already-clear questions, so rollout should bias toward fail-open behavior and explicit acceptance coverage for exact, specific requests.
- The gatekeeper should complement query rewrite, hybrid retrieval, and reranking rather than replace them; its job is to decide whether the request is ready for those systems at all.
