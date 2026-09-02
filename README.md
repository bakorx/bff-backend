# Backend Readme - State & App Lifecycle

## App Initialization

### 1) Bootstrapping Flow (`src/index.ts`)

The application follows a standard startup sequence:

1. **Database Connection**: Establishes connection to MongoDB via Mongoose.
2. **Server Start**: Initializes the Express server on the configured port.
3. **Queue/Worker Initialization**: (In worker processes) Starts listening to BullMQ queues.
4. **Signal Handling**: Graceful shutdown on `SIGINT`/`SIGTERM` (closing DB connections and stopping server).

### 2) Entry Points

- `src/server.ts`: Configures Express middleware (cors, body-parser, auth) and registers routes.
- `src/worker.ts`: Entry point for background worker processes.

## State Management

### 1) Database Persistence

- **Mongoose**: Primary ODM for MongoDB.
- **Models**: Located in `src/<module>/models.ts`.
- **Connections**: Managed centrally in `src/db/index.ts`.

### 2) Ephemeral State & Sockets

- Socket.io is used for real-time bidirectional communication.
- Socket handlers are managed in `src/socket/`.

### 3) Queues (BullMQ/Redis)

- Redis is used as the backing store for BullMQ.
- State transitions triggered by background jobs are persisted back to MongoDB by workers.

## Environment & Configuration

### 1) Centralized Config

- Configuration is managed in `src/config/`.
- Environment variables are validated on startup to ensure all required secrets (DB URI, Redis URI, API Keys) are present.

### 2) Multi-tenancy / User Isolation

- All state queries must be scoped to the `userId` where applicable.
- Authentication middleware ensures `user` context is available in all protected controllers.

## OAuth Setup (Google — Phase A, GitHub — Phase B)

The backend implements the **Google Identity Services (GIS) in-page popup**
flow for OAuth providers. The frontend loads `https://accounts.google.com/gsi/client`,
calls `accounts.id.prompt()` to surface Google's consent modal over the page,
and POSTs the resulting `id_token` to `/api/v1/auth/oauth/google`. The backend
verifies the id_token against Google's public JWKS and either logs the user in,
auto-links the provider by email, or creates a fresh account.

The `client_id` is published on the frontend (`NEXT_PUBLIC_GOOGLE_CLIENT_ID`)
because GIS requires it — it is NOT a secret. The backend verifies id_tokens
without any client secret because the implicit-flow signature is the trust anchor.

### Auto-link by email

When the Google account's email matches an existing Qz user, the provider is
linked automatically and the user is logged in directly. A notification email
(`account_linked` transactional campaign) is sent so the account owner can
detect a takeover from settings.

The only thing stopping cross-account abuse is the
`(provider, providerUserId)` uniqueness guard inside `linkProvider`. If the
same Google account is already linked to a *different* Qz user, the controller
returns `409 Conflict` and the frontend surfaces the error. The original user
still owns their account and can still log in with email + password.

### Google OAuth (Phase A)

**1) Create the OAuth client in Google Cloud Console**

1. Go to https://console.cloud.google.com/ → your project (create one if needed).
2. **APIs & Services** → **Library** → enable **Google Identity** (or **Google+ API**)
   if not already.
3. **APIs & Services** → **OAuth consent screen**:
   - User type: **External**
   - App name: `Qz` (or your brand name)
   - Support email: your address
   - Scopes: `openid`, `email`, `profile`
   - Test users (while in testing mode): add the Gmail addresses you'll sign in with
4. **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**:
   - Application type: **Web application**
   - Name: `Qz Backend` (or any label)
5. Copy the **Client ID** into both:
   - Backend `.env` → `GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com`
   - Frontend `.env.local` → `NEXT_PUBLIC_GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com`
   (Both must match exactly.)
6. No **Authorized JavaScript origins** or **Authorized redirect URIs** need
   to be configured for this flow — GIS uses Google's hosted consent UI, not
   a redirect on your domain.

**2) Verify**

```bash
# Typecheck
cd quizzes_backend && ./node_modules/.bin/tsc --noEmit
cd quizzes_frontend && ./node_modules/.bin/tsc --noEmit
```

Manual smoke test once Mongo + Redis are running:
- **New user via Google**: click "Continue with Google" → consent modal opens over the page → land on `/onboarding` → land on `/dashboard`. Sign out, sign in again with Google → should skip onboarding.
- **Existing user, same email**: sign up via email first, log out, click "Continue with Google" with the same Google account → the provider is auto-linked, user lands directly in `/app`. The original user receives an `account_linked` notification email. Verify `linkedProviders` is populated on the user record in MongoDB.
- **Takeover attempt**: a different Qz user signing in with a Google account that is *already linked* to someone else gets `409 Conflict` — no silent link, no session.

### GitHub OAuth (Phase B — placeholder)

GitHub does not ship a browser-side identity-services script equivalent to
Google's GIS. Phase B will use the **authorization-code redirect flow**:
frontend navigates to a backend `/auth/oauth/github/start` route, the backend
redirects to `https://github.com/login/oauth/authorize`, GitHub redirects back
to `/auth/oauth/github/callback` with a `code`, and the backend exchanges it
server-side using `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`. Configure at:

1. https://github.com/settings/developers → **New OAuth App**:
   - Homepage URL: `https://app.example.com`
   - Authorization callback URL: `https://api.example.com/api/v1/auth/oauth/github/callback`
2. Copy the **Client ID** and generate a **Client Secret** (with expiry disabled).
3. Add to backend `.env`:
   ```
   GITHUB_CLIENT_ID=Iv1.xxxxx
   GITHUB_CLIENT_SECRET=xxxxx
   ```
4. The backend's `linkedProviders` schema already accepts `provider: 'github'`,
   so no migration is needed when Phase B ships.

### Security notes

- **No client secret is used in the GIS popup flow.** The id_token's RS256
  signature, verified against Google's public JWKS, is the trust anchor.
- `id_token` claims (`iss`, `aud`, `email_verified`, `exp`) are validated on
  the backend before any user record is created or linked.
- The `NEXT_PUBLIC_GOOGLE_CLIENT_ID` on the frontend is a public identifier
  by Google's design — it's not a secret, and exposing it does not weaken
  auth.
- The `account_linked` notification email is sent for every auto-link event
  so the account owner can detect (and unlink from settings) a takeover.
- Auto-link is gated on `linkProvider`'s `(provider, providerUserId)`
  uniqueness check — a Google account already linked to a *different* Qz
  user returns `409`, never silently overwrites.

## AI Study Partner Sessions

### 1) Core Lifecycle

The AI Study Partner system follows a step-based state machine orchestrated via BullMQ:

1. **Creation**: `POST /sessions` creates the initial record.
2. **Initialization**: `POST /sessions/:id/start` triggers the first AI planning stage (queued).
3. **User Interaction**: `POST /sessions/:id/step` submits user messages, plan approvals, or edits (queued).
4. **Real-time Streaming**: `GET /sessions/:id/stream` provides an SSE channel for AI-generated response chunks.

### 2) Backend Worker flow

- **Step Worker**: Parses incoming step types (`initialize`, `message`, `approve_plan`, etc.) and determines the next model action.
- **Generate Worker**: Calls AI model providers and streams chunks/state updates back to the user's SSE connection.
- **Dispatch Worker**: Orchestrates high-level flow transitions between session modes.

### 3) Session Title Contract

- The title is **generated server-side** after the first meaningful interaction.
- Once generated, it is persisted to the session model and returned in all subsequent list/detail responses.

---

_Last Updated: 2026-03-18_

## Docker Deployment (VPS)

This repo now includes a production-ready container build:

- `Dockerfile` (multi-stage build)
- `.dockerignore` (smaller/faster build context)
- `docker-compose.yml` (app + worker + redis)

### 1) Build Image

```bash
docker build -t qz-backend:latest .
```

### 2) Run With Docker Compose (Recommended)

```bash
docker compose up -d --build
```

### 3) Stop Services

```bash
docker compose down
```

### 4) View Logs

```bash
docker compose logs -f app
docker compose logs -f worker
```

### Notes

- Ensure `.env` contains production values (MongoDB URI, Redis URL, API keys, etc.).
- The `app` service listens on port `5000`.
- The `worker` service runs background BullMQ jobs via `dist/worker.js`.
- For production VPS setups, prefer managed MongoDB/Redis when possible.

## Makefile Shortcuts

To simplify day-to-day Docker usage, this repo includes a `Makefile`.

```bash
make help
make build
make up
make logs
make logs-app
make logs-worker
make down
```

Useful extras:

- `make rebuild` to rebuild without Docker cache
- `make shell-app` to open a shell in the app container
- `make clean` to remove containers and volumes
