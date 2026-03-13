# Google OAuth Requirements

## Goal
Add Google OAuth login so each chat request is tied to a user identity and conversations can be scoped per user.

## Functional Requirements
1. Users can sign in with Google.
2. Users can sign out and terminate local session.
3. Application identifies current user on each protected request.
4. Chat and conversation data are accessible only to the authenticated owner.
5. Ingestion/admin actions are restricted to authorized roles.

## Google Cloud Setup Requirements
1. A Google Cloud project exists for this app.
2. OAuth Consent Screen is configured (`External` or `Internal` as needed).
3. OAuth client type is `Web application`.
4. Authorized JavaScript origins include local and deployed app URLs.
5. Authorized redirect URIs include auth callback endpoint(s), for example:
- `http://localhost:3000/api/auth/callback/google`

## Environment Requirements
1. `GOOGLE_CLIENT_ID` is configured.
2. `GOOGLE_CLIENT_SECRET` is configured.
3. Auth/session secret is configured (for cookie/session signing).
4. Secrets are loaded from env/secrets manager and never hardcoded.

## Data Model Requirements
1. `users` table: `id`, `email`, `name`, `avatar_url`, timestamps.
2. OAuth account linkage table (provider + provider account id + user id).
3. Session table (if database-backed sessions are used).
4. Conversations/messages include `user_id` foreign key.

## API and Authorization Requirements
1. Auth middleware resolves current user identity.
2. Protected routes return `401` when unauthenticated.
3. Cross-user access returns `403` or `404`.
4. Role checks are enforced for admin-only routes.

## Security Requirements
1. Use secure, HTTP-only cookies for session tokens.
2. Enable CSRF protections for session-based flows.
3. Validate Google tokens through trusted library/provider flow.
4. Log auth events without leaking secrets.
5. Do not commit OAuth JSON/client secrets to repo.

## Local Development Requirements
1. Local callback URI registered in Google OAuth app.
2. `.env.local` contains Google OAuth credentials.
3. Local login flow can complete and create/reuse user record.

## Acceptance Criteria
1. Unauthenticated request to protected chat/session endpoint gets `401`.
2. Authenticated user can create/load only their own conversations.
3. User A cannot access User B conversation data.
4. Google sign-in and sign-out both succeed in local environment.
5. Secrets are not present in committed files.
