# Chat to Conversation Transition

## Purpose
Explain how real-time chat (`/api/chat`) should transition into persisted conversation flows (`/api/conversations/*`), based on current code.

## Current State (as implemented)
- `POST /api/chat`:
  - Requires auth + CSRF.
  - Takes in-memory `messages` from the UI.
  - Runs retrieval and Gemini generation.
  - Returns `{ content, sources }`.
  - Does **not** create or write conversation records.
- Conversation APIs already exist:
  - `GET/POST /api/conversations`
  - `GET/PATCH/DELETE /api/conversations/[conversationId]`
  - `GET/POST /api/conversations/[conversationId]/messages`
- `ChatBox` currently sends prompts directly to `/api/chat` and keeps message history in component state.

## Transition Goal
Move from "stateless chat request" to "chat tied to an active conversation id" so history is durable and user-scoped.

## Persistence Requirement (Updated)
- Chat history must be persisted for future use.
- "Future use" means users can leave, refresh, sign out, and later return to the same saved conversation history.
- Persistence should happen per turn (user and assistant), not only at session end, to reduce data loss risk.

## Recommended Runtime Flow
1. On app load (authenticated user), call `GET /api/conversations`.
2. If user selects an existing conversation:
  - Set `activeConversationId`.
  - Load history via `GET /api/conversations/[conversationId]/messages`.
3. If user starts a new chat:
  - Call `POST /api/conversations` first.
  - Store returned `conversation.id` as `activeConversationId`.
4. On send:
  - Persist user turn via `POST /api/conversations/[conversationId]/messages` (`role: "user"`).
  - Call `POST /api/chat` with current conversation messages.
  - Persist assistant turn via `POST /api/conversations/[conversationId]/messages` (`role: "assistant"`).
5. On reload:
  - Re-fetch conversation list and selected conversation messages from DB instead of rebuilding from local state.

## Why Keep `/api/chat` Separate
- `/api/chat` focuses on retrieval + grounded generation.
- Conversation routes focus on ownership, CRUD, and durable history.
- This separation keeps responsibilities clean and simpler to test.

## Error Handling Rules
- If message persistence fails before chat call: do not call `/api/chat`; show retry.
- If `/api/chat` fails after user message is saved: keep saved user turn and show system error turn (optionally persist it).
- If assistant persistence fails: show assistant reply in UI with "not saved" warning and retry save.

## Security and Ownership
- Conversation APIs enforce owner-only access (`requireConversationOwner`).
- Mutating conversation endpoints require CSRF.
- `POST /api/chat` still requires auth + CSRF, but it does not itself enforce conversation ownership because no `conversationId` is passed today.

## Suggested Next Implementation Tasks
- Add `activeConversationId` state in `ChatBox`.
- Add conversation sidebar/list/create/select UI.
- Read/write message history through conversation routes.
- Optionally extend `/api/chat` to accept `conversationId` and validate ownership server-side for stronger consistency.
