# Ambiguity Gatekeeper for Chat Implementation Plan

Status: implemented on the current branch

Goal: add a rollout-gated ambiguity gatekeeper to `POST /api/chat` that asks one clarifying question for underspecified chat requests and otherwise preserves the normal retrieval-and-answer flow.

Architecture: the gatekeeper lives in a deep chat module, uses dedicated config and Gemini helpers, runs before retrieval in `src/app/api/chat/route.ts`, and fails open to the normal chat path on timeout, malformed output, or provider error. `POST /api/retrieve` remains unchanged in phase 1.

## Files

New files:
- `src/lib/chat/ambiguityGatekeeperConfig.ts`
- `src/lib/chat/ambiguityGatekeeperConfig.test.ts`
- `src/lib/chat/ambiguityGatekeeper.ts`
- `src/lib/chat/ambiguityGatekeeper.test.ts`
- `docs/features/ambiguity-gatekeeper/TEST_QUERIES.md`

Modified files:
- `src/lib/gemini.ts`
- `src/lib/gemini.test.ts`
- `src/lib/quota/queryQuota.ts`
- `src/app/api/chat/route.ts`
- `src/app/api/chat/route.test.ts`
- `README.md`
- `package.json`
- `docs/features/ambiguity-gatekeeper/CHECKLIST_PLAN.md`

## Response Contract

Normal non-ambiguous chat response remains:

```ts
{
  content: string;
  sources: Array<{
    number: number;
    title: string | null;
    url: string;
  }>;
}
```

Ambiguous clarification response in phase 1:

```ts
{
  content: string;
  sources: [];
  needsClarification: true;
  clarificationReason?: string | null;
}
```

## Environment Contract

Implemented environment variables:

```txt
AMBIGUITY_GATEKEEPER_ENABLED=false
AMBIGUITY_GATEKEEPER_API_KEY=<optional; falls back to GEMINI_API_KEY>
AMBIGUITY_GATEKEEPER_MODEL_NAME=gemini-2.5-flash
AMBIGUITY_GATEKEEPER_MODEL_API_VERSION=v1beta
AMBIGUITY_GATEKEEPER_TIMEOUT_MS=2000
AMBIGUITY_GATEKEEPER_DEBUG=false
```

## Implementation Summary

### 1. Config and Gemini helpers

- [x] Added `resolveAmbiguityGatekeeperConfig(...)` in `src/lib/chat/ambiguityGatekeeperConfig.ts`.
- [x] Kept the gatekeeper disabled by default for rollout safety.
- [x] Added strict positive-integer validation for timeout values.
- [x] Added `getAmbiguityGatekeeperApiKey(...)` and `getAmbiguityGatekeeperGenAI(...)` in `src/lib/gemini.ts`.
- [x] Removed the eager shared Gemini client requirement at import time by switching `src/lib/gemini.ts` to lazy shared-client initialization.

Current behavior:
- config resolution is deterministic
- `AMBIGUITY_GATEKEEPER_API_KEY` falls back to `GEMINI_API_KEY`
- malformed timeout values like `1.5` and `2000ms` throw

### 2. Deep gatekeeper module

- [x] Added `checkQueryAmbiguity(...)` in `src/lib/chat/ambiguityGatekeeper.ts`.
- [x] Added prompt construction with bounded history rendering.
- [x] Added structured JSON parsing and schema validation.
- [x] Added fail-open behavior for malformed output, timeout, and provider errors.
- [x] Kept the provider call single-shot with no retry loop.

Current behavior:
- request shape is `{ userMessage, history }`
- result shape is a normalized `proceed` or `clarify` decision
- clarification requires one non-empty `clarificationQuestion`
- Gemini fallback does not inject prior history into `startChat`; history is embedded only in the prompt

### 3. Chat route integration

- [x] Integrated the gatekeeper into `POST /api/chat` before retrieval.
- [x] Added `previewQueryQuota(...)` in `src/lib/quota/queryQuota.ts` for non-mutating prechecks.
- [x] Added early 429 rejection before gatekeeper execution when the request is already over quota.
- [x] Added clarification-path quota consumption before returning the clarification payload.
- [x] Skipped `retrieveRelevantChunks(...)` and `sendChatWithFallback(...)` when the gatekeeper decides `clarify`.

Current route behavior:
1. parse user message and retained history
2. preview quota using `[userMessage, ...historyTexts]`
3. run the gatekeeper
4. if `clarify`, consume quota and return clarification payload with `sources: []`
5. otherwise continue the existing retrieval and answer flow

### 4. Acceptance coverage

- [x] Added module tests for:
  - ambiguous requests
  - exact identifiers
  - config paths
  - file names
  - CLI commands
  - history-aware follow-ups
  - disabled mode
  - malformed output
  - timeout fail-open
  - Gemini fallback behavior
- [x] Added route tests for:
  - clarification short-circuit
  - normal proceed behavior
  - over-quota rejection before gatekeeper
  - clarification-path quota consumption
  - fail-open when the gatekeeper throws
  - CLI command proceed behavior

### 5. Documentation and verification assets

- [x] Documented the gatekeeper in `README.md`.
- [x] Added `docs/features/ambiguity-gatekeeper/TEST_QUERIES.md`.
- [x] Added `test:ambiguity-gatekeeper` to `package.json`.
- [x] Marked the feature checklist complete in `docs/features/ambiguity-gatekeeper/CHECKLIST_PLAN.md`.

## Verification

Passed on this branch:

- `npm run test:ambiguity-gatekeeper`
- `npm test -- src/app/api/chat/route.test.ts src/app/api/retrieve/route.test.ts`

## Notes

- The gatekeeper applies only to `POST /api/chat` in phase 1.
- `POST /api/retrieve` stays non-interactive.
- Gatekeeper diagnostics remain internal to server logs; there is no chat debug payload in phase 1.
