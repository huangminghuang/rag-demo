# Google OAuth Checklist Plan

## 1. Provider and Project Setup
- [x] Create/select Google Cloud project.
- [x] Configure OAuth consent screen (app name, support email, developer contact).
- [x] Create OAuth client (`Web application`).
- [x] Add local authorized origin (`http://localhost:3000`).
- [x] Add local callback URI (`/api/auth/callback/google`).
- [x] Add deployed origins/callbacks for staging/production (if applicable).

## 2. Secrets and Environment
- [x] Implement credential loading order: env first, `.secrets/google_oauth.json` fallback.
- [x] Map `GOOGLE_CLIENT_ID` from fallback JSON when env value is missing.
- [x] Map `GOOGLE_CLIENT_SECRET` from fallback JSON when env value is missing.
- [x] Add app auth/session secret to env.
- [x] Confirm secrets are ignored by git and not committed.
- [x] Document env + fallback behavior in README.

## 3. Auth Integration in App
- [x] Add auth library/provider integration for Google OAuth.
- [x] Implement sign-in endpoint and callback handler.
- [x] Implement sign-out endpoint.
- [x] Add middleware to resolve current user/session.
- [x] Add protected-route guard utility.

## 4. Data Model and Persistence
- [x] Create `users` table.
- [x] Create provider-account linkage table.
- [x] Create session table (if DB-backed sessions are used).
- [x] Add `user_id` to conversations/messages.
- [x] Add migrations and verify schema in local DB.

## 5. Authorization Rules
- [x] Enforce `401` for unauthenticated access to protected routes.
- [x] Enforce owner-only access for conversations/messages.
- [x] Enforce role checks for admin-only operations (for example ingestion trigger).
- [x] Add standard `403/404` behavior for unauthorized resource access.

## 6. UI and Session UX
- [x] Add "Sign in with Google" UI flow.
- [x] Add logged-in user indicator and sign-out control.
- [x] Add behavior for unauthenticated user (redirect or disabled chat).
- [x] Ensure existing chat UX remains simple after auth.

## 7. Security Hardening
- [ ] Use secure, HTTP-only cookies.
- [ ] Enable CSRF safeguards for session-based flows.
- [ ] Validate and sanitize callback/session inputs.
- [ ] Add login/auth event logging without leaking sensitive data.

## 8. Verification and Acceptance
- [ ] Verify Google login works in local environment.
- [ ] Verify sign-out invalidates session.
- [ ] Verify User A cannot access User B conversations.
- [ ] Verify protected routes return correct `401/403` responses.
- [ ] Run regression check for chat/retrieve/ingest flows after auth integration.

## 9. Testing Subsection (When Applicable)

### 9.1 Unit Tests (Automatable)
- [x] Scaffold unit test framework (`vitest`) and npm scripts.
- [x] Add tests for Google credential loading (env-first, JSON fallback, error path).
- [ ] Add tests for auth middleware (`401` on missing session).
- [ ] Add tests for authorization guards (owner-only access, admin-only routes).
- [ ] Add tests for session helper utilities.
- [ ] Add tests for CSRF helper/validation logic.

### 9.2 Integration Tests (Automatable)
- [ ] Add local auth callback route tests with mocked provider responses.
- [ ] Add DB-backed session integration tests.
- [ ] Add API tests ensuring conversation data is user-scoped.

### 9.3 Manual Verification (Provider Console Dependent)
- [ ] Verify Google Cloud Console OAuth settings (origins/callbacks).
- [ ] Verify consent screen/test users configuration.
- [ ] Verify full browser sign-in/sign-out flow end-to-end.
