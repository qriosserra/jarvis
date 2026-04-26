# ── Base stage ───────────────────────────────────────────
FROM node:22-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    libopus-dev \
    ffmpeg \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

# Enable Corepack so the pinned pnpm version from packageManager is used
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

# ── Build stage ──────────────────────────────────────────
FROM base AS build

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm run build

# ── Development stage ────────────────────────────────────
FROM base AS development

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ENV NODE_ENV=development
CMD ["pnpm", "run", "dev:docker"]

# ── Production stage ─────────────────────────────────────
FROM base AS production

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/dist ./dist
COPY src/db/schema.sql ./dist/db/schema.sql
COPY src/db/migrations ./dist/db/migrations

ENV NODE_ENV=production
RUN mkdir -p /app/logs && chown node:node /app/logs
USER node

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD pnpm node dist/validate-startup.js || exit 1

CMD ["pnpm", "node", "dist/index.js"]
