# MedAssist API on Hugging Face Spaces (Docker).
# HF builds the repo-root Dockerfile; the app lives in apps/api/.
# Runtime listens on $PORT (HF sets 7860; default 3000, see apps/api/src/config.ts).

FROM node:22-slim AS builder
WORKDIR /app
# openssl is required by the Prisma engines
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY apps/api/package.json apps/api/package-lock.json ./apps/api/
RUN cd apps/api && npm ci
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/src ./apps/api/src
RUN cd apps/api && npx prisma generate && npm run build

FROM node:22-slim AS runtime
WORKDIR /app/apps/api
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY apps/api/package.json apps/api/package-lock.json ./
# Full node_modules from the builder, including the `prisma` CLI which is
# needed to run `migrate deploy` at container boot.
COPY --from=builder /app/apps/api/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/prisma ./prisma
EXPOSE 7860
# Apply pending DB migrations, then start the API.
# Required env (set as Space secrets, never baked in): DATABASE_URL, JWT_SECRET,
# GEMINI_API_KEY, CEREBRAS_API_KEY. PORT is honored automatically.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
