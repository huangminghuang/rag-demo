# Ambiguity Gatekeeper Test Queries

Purpose: Repeatable checks for ambiguity detection, clarification behavior, and history-aware chat gating.

Version: `v1`

## Usage Notes

- Run `npm run test:ambiguity-gatekeeper` to execute the focused automated gatekeeper suite.
- Use these queries against `POST /api/chat` when checking rollout behavior manually.
- Keep the wording unchanged during evaluation.
- The matrix below is a planning and verification aid for the phase-1 gatekeeper behavior.
- Compare:
  - whether clear requests proceed without clarification
  - whether broad requests get exactly one targeted clarification question
  - whether retained history makes short follow-ups clear
  - whether failure modes fail open to normal chat behavior

## Test Matrix

| ID | Category | Expected Decision | Context | Query |
|---|---|---|---|---|
| AG01 | broad underspecified request | clarify | none | How is Vite doing? |
| AG02 | broad underspecified request | clarify | none | Can you explain this config? |
| AG03 | unclear pronoun reference | clarify | none | What about that? |
| AG04 | specific documentation question | proceed | none | How do environment variables work in Vite? |
| AG05 | exact identifier | proceed | none | `import.meta.env` |
| AG06 | exact config path | proceed | none | `server.proxy` |
| AG07 | exact file name | proceed | none | `vite.config.ts` |
| AG08 | exact CLI command | proceed | none | `vite build` |
| AG09 | exact CLI command | proceed | none | `vite preview` |
| AG10 | specific documentation question | proceed | none | How do I configure a proxy for local API calls in Vite? |
| AG11 | exact identifier in sentence | proceed | none | How do I use `server.proxy` in `vite.config.ts`? |
| AG12 | history-aware follow-up | proceed | Previous turns discussed Vite config and client/server behavior. | What about SSR? |
| AG13 | history-aware follow-up | proceed | Previous turns discussed the dev server and local API forwarding. | how does that work there? |
| AG14 | broad documentation question | proceed | none | How does Vite dependency pre-bundling work? |

## Expected Gatekeeper Characteristics

For clarify decisions:

- Return exactly one targeted clarification question.
- Avoid multi-question or open-ended clarification prompts.
- Keep the clarification question short and specific enough to unblock the next turn.

For proceed decisions:

- Preserve exact identifiers, config paths, file names, and commands as proceed cases.
- Let retained history resolve short follow-up questions when the context makes the latest message clear.
- Keep the normal chat flow unchanged when the gatekeeper decides not to clarify.

For failure cases:

- Malformed output should fail open to normal chat behavior.
- Timeout should fail open to normal chat behavior.
- Provider errors should fail open to normal chat behavior.

## Suggested Manual Checks

1. Run AG01 through AG03 and confirm the route returns a clarification payload with `sources: []`.
2. Run AG04 through AG10 and confirm the route proceeds without clarification.
3. Run AG11 through AG13 with their context notes and confirm short follow-ups stay on the normal chat path.
4. Force a gatekeeper failure or malformed response and confirm the request still falls through to normal chat behavior.
