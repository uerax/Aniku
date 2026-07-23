# Aniku — single image: Hono API + Vite SPA
# Build:  docker build -t aniku .
# Run:    docker compose up -d --build
#         open http://localhost:$WEB_PORT  (compose maps host WEB_PORT → container PORT)

# ---- deps ----
FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# ---- build frontend + server bundle ----
FROM deps AS build
COPY . .
RUN pnpm --filter @aniku/web build \
 && pnpm --filter @aniku/server build

# ---- runtime (node dist only; no tsx / no full monorepo src) ----
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    WEB_DIST=public

WORKDIR /app

# Bundled server is self-contained; only need the JS + SPA assets
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/web/dist ./public

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# cwd=/app so WEB_DIST=public and resolveWebRootRel finds ./public
CMD ["node", "dist/index.js"]
