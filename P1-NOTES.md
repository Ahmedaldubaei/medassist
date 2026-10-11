# P1 — Backend + Auth + DB + pgvector (done 2026-10-11)

## What was built
`apps/api/` — Node 24 + TypeScript strict + Fastify v5 + Prisma 6.5 + PostgreSQL 16 + pgvector.
- `src/index.ts` — bootstrap + graceful shutdown (SIGINT/SIGTERM)
- `src/config.ts` — zod-validated env (DATABASE_URL, JWT_SECRET min 32, PORT)
- `src/db.ts` — PrismaClient singleton
- `src/lib/password.ts` — bcrypt (cost 12); `src/lib/jwt.ts` — sign/verify (7d)
- `src/plugins/auth.ts` — `authenticate` + `requireRole(...)`; `src/plugins/errors.ts` — uniform `{error:{code,message}}` (Zod→400, P2002→409)
- `src/routes/health.ts` — GET /health → {status, db}; `src/routes/auth.ts` — register/login/me + rate limit on auth routes
- Prisma schema: User, Conversation, Message, KnowledgeDocument, KnowledgeChunk (embedding `vector(1024)`), AgentRun, SafetyReview, AuditLog + enums
- Migrations: `0000_enable_pgvector` (CREATE EXTENSION) + `init` (tables)
- Tests (vitest): 7/7 green — health, register→login→me, dup 409, wrong pw 401, bad token 401, validation 400, passwordHash never leaked

## Environment decisions (local dev only)
- Postgres 16 cluster started locally; DBs `medassist` (dev) + `medassist_test`.
- Role `medassist` / password `medassist_dev_only` (dev only). Role is SUPERUSER — required because
  Prisma's shadow DB must `CREATE EXTENSION vector`. Never use this role in production.
- Prisma pinned to **6.5.0**: `binaries.prisma.sh` is unreachable through the egress proxy (ECONNRESET
  in postinstall), so install used `--ignore-scripts` and engine binaries
  (`libquery_engine-*.so.node`, `schema-engine-*`) were copied from `~/postiz-app/node_modules/@prisma/engines`
  (also Prisma 6.5.0 — version must match exactly).
- `dotenv` added: `src/config.ts` loads `.env` (dev-only secrets; see `.env.example`).
- First registered user becomes ADMIN automatically (bootstrap convenience).

## Verified live
- `npm run build && node dist/index.js` → curl /health = 200 {status:ok, db:ok}
- register → 201, login → 200 + JWT, /me with token → 200, wrong password → 401
- pgvector PoC: inserted two 1024-dim synthetic vectors, `<->` similarity search returned nearest-first (dist 0.000 vs 16.000)

## Run
```
cd apps/api
npx prisma migrate dev        # dev DB
npm run dev                   # tsx watch, :3000
npm test                      # vitest (uses medassist_test)
```

## Next (P2)
- Knowledge ingestion pipeline (chunking 1000/200, multilingual embeddings, ivfflat index)
- Hybrid retrieval (vector + keyword, RRF) — tables are ready.
