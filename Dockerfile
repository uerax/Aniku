# Aniku — single image: Hono API + Vite SPA
# Build:  docker build -t aniku .
# Run:    docker compose up -d --build
#         open http://localhost:$WEB_PORT  (from .env, default 5173)

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

# ---- build frontend ----
FROM deps AS build
COPY . .
RUN pnpm --filter @aniku/web build

# ---- runtime ----
FROM base AS runner
# pnpm --filter runs with cwd=apps/server; keep SPA next to the server package
# so WEB_DIST=public resolves, and also at /app/public for root cwd.
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    WEB_DIST=public

WORKDIR /app

# Workspace manifests + packages needed at runtime
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
# Minimal stub so the workspace graph still resolves (web is not executed)
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile --filter @aniku/server... --filter @aniku/shared

COPY apps/server/src apps/server/src
COPY apps/server/tsconfig.json apps/server/
COPY packages/shared/src packages/shared/src
COPY packages/shared/tsconfig.json packages/shared/
# SPA: apps/server/public (matches filter cwd) + /app/public (matches monorepo root)
COPY --from=build /app/apps/web/dist apps/server/public
COPY --from=build /app/apps/web/dist public

# Default API/SPA listen port (override with PORT at runtime)
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "--filter", "@aniku/server", "start"]
