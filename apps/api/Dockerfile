# MedAssist API — multi-stage Docker build.
# Runtime listens on $PORT (default 3000, see src/config.ts).

FROM node:22-slim AS builder
WORKDIR /app
# openssl is required by the Prisma engines
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
COPY tsconfig.json ./
COPY src ./src
RUN npx prisma generate
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Full node_modules from the builder, including the `prisma` CLI which is
# needed to run `migrate deploy` at container boot.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
EXPOSE 3000
# Apply pending DB migrations, then start the API.
# Required env (set by the platform, never baked in): DATABASE_URL, JWT_SECRET,
# GEMINI_API_KEY, CEREBRAS_API_KEY. PORT is honored automatically (default 3000).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
