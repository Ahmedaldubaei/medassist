# P6 — Security Audit + Backend Fixes (part 1: code only, no deploy)

Date: 2026-10-11. Scope: `apps/api/src/` + Prisma. No deployment (user decision pending).

## 1. Security audit — findings & fixes

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| 1 | **CRITICAL** | **Privilege escalation in `POST /api/v1/auth/register`**: `role` was accepted from the request body (`body.role ?? 'STUDENT'`), so any self-registering user could pass `role: "ADMIN"` and become admin. | Removed `role` from `registerSchema` (zod strips it). Role is now server-assigned only: first user ever → `ADMIN` (bootstrap), everyone else → `USER`. New `USER` value added to the `Role` enum via migration `20261011053000_add_user_role` (applied to dev + test DBs, client regenerated). |
| 2 | **HIGH** | **SSRF in `fetchUrlText`** (`POST /api/v1/admin/ingest` → `{url}`): only the protocol was checked. An admin could make the server fetch `localhost`, private ranges, or the cloud metadata IP `169.254.169.254` (chained with finding #1 → critical). | New `assertPublicUrl()`: DNS-resolves the hostname and rejects private/loopback/link-local/CGNAT/multicast/reserved ranges (v4 + v6 + v4-mapped). Redirects are now followed **manually** (max 3 hops) with per-hop re-validation, since `fetch`'s automatic redirects would skip the check. Exported `isBlockedIp()` for tests. Residual: DNS-rebinding TOCTOU is out of scope (documented). |
| 3 | **MEDIUM** | JWT `authenticate` accepted any string `role` from the token payload. | Now validates `payload.role` against the Prisma `Role` enum; unknown roles → 401. (Defense in depth; tokens are server-minted after fix #1.) |
| 4 | **MEDIUM** | `POST /api/v1/knowledge/search` had only the global 300/min limit — each call runs a local embedding (CPU-heavy). | Dedicated rate limit: 60/min. |
| 5 | **LOW** | `GEMINI_MODEL` default was `gemini-2.5-flash`, which returns 404 for new API users. | Default → `gemini-3.8-flash` (verified live). `.env`/`.env.example` already carried the new value. |

**Checked and clean (no change needed):**
- **SQL injection**: all `$queryRaw`/`$executeRaw` use Prisma bound parameters (`${}` in tagged templates, `Prisma.sql` fragments). No string concatenation.
- **JWT**: HS256, secret ≥32 chars enforced by zod, 7-day expiry. bcrypt cost 12.
- **Secrets in logs/responses**: providers log only the provider *name*; error handler returns generic `INTERNAL_ERROR` for 500s; `publicUser` never includes `passwordHash` (test-enforced).
- **Input validation**: zod on every route body/query/params (new endpoints included).
- **IDOR**: `runChat` scopes conversations by `userId`; new history endpoints enforce `findFirst({id, userId})` → 404 otherwise (test-enforced).
- **ADMIN gates**: `/api/v1/admin/ingest` requires `authenticate` + `requireRole('ADMIN')`, 10/min limit, audit-logged.
- **CORS**: `@fastify/cors` is **not** registered — cross-origin browser calls are blocked by default (secure default). The Expo mobile app is unaffected; the web build works when served same-origin. If the web client is ever hosted on a different origin, add `@fastify/cors` with an explicit origin allowlist (never `*`).

**Known limitations (not fixed, documented):**
- First-user ADMIN bootstrap has a check-then-act race: two *simultaneous* first registrations could both become ADMIN. Acceptable for a bootstrap convenience; production should seed the admin out-of-band and disable public registration.
- No account lockout on login (20/min rate limit + bcrypt cost 12 is the current mitigation).
- Demoted admins keep their old role until their JWT expires (≤7d).

## 2. Default-role decision (from P1 note)

Verified: the first registered user became ADMIN **by design** (bootstrap), but **every** registrant could also self-assign `ADMIN` via the body — that was the bug, not the bootstrap. Fixed per above: bootstrap stays, default is now `USER` (new enum value; `STUDENT` remains available for explicit assignment later). Decision recorded here per task instruction.

## 3. New endpoints (conversation history)

The Expo app previously showed only a local history. Added `src/routes/conversations.ts`, registered in `src/index.ts`:

- `GET /api/v1/conversations?limit=&cursor=` — authenticated, 60/min. Newest-first, cursor pagination (`limit` 1–50, default 20). Returns `id, title, createdAt, messageCount, lastMessage{role, preview(200 chars), createdAt}`, plus `nextCursor`.
- `GET /api/v1/conversations/:id/messages?limit=&cursor=` — authenticated, 120/min. Strictly scoped to the caller's conversations (else 404). Oldest-first, cursor pagination (`limit` 1–100, default 50). Returns `id, role, content, agentUsed, citations, confidence, createdAt`, plus `nextCursor`.

Safety gate behavior unchanged — these are read-only history endpoints.

## 4. Tests

- `tests/auth.test.ts` (+2): first user → ADMIN; `role:"ADMIN"` in body is ignored → USER; escalated login still gets 403 on the admin ingest route.
- `tests/conversations.test.ts` (new, 8): 401 unauthenticated, empty list, list shape/order/count/lastMessage, cursor pagination (no dupes), cross-user isolation (list empty + 404 on other's thread), chronological messages, 404 unknown id, 400 bad limit.
- `tests/rag-ssrf.test.ts` (new, 5): blocked ranges (v4/v6/mapped), public IPs allowed, protocol rejection, localhost/127.0.0.1 rejection via `assertPublicUrl`.
- `npx tsc --noEmit`: clean. Full suite: **91/91 green** (11 files) — was 76 before P6; +15 new.

## 5. Files changed

- `src/routes/auth.ts` — role fix
- `src/plugins/auth.ts` — JWT role allowlist
- `src/rag/ingest.ts` — SSRF guard (`assertPublicUrl`, `isBlockedIp`, manual redirects)
- `src/routes/rag.ts` — search rate limit
- `src/config.ts` — Gemini model default
- `src/routes/conversations.ts` — new; `src/index.ts` — registered
- `prisma/schema.prisma` + `prisma/migrations/20261011053000_add_user_role/` — `USER` role
- `tests/auth.test.ts`, `tests/conversations.test.ts`, `tests/rag-ssrf.test.ts`

## 6. Not done (later phases per user)

Deployment, public URL, visual QA, Android AAB/APK, iOS setup — all await the user's explicit go-ahead. No secrets were printed or stored outside the project's `.env`.
