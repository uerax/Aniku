# Animaku — single image: Hono API + Vite SPA
# Build:  docker build -t animaku .
# Run:    docker compose up -d --build
#         open http://localhost:$PORT  (default 8787; SPA + /api same origin)

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

# Footer / branding is Vite build-time (VITE_*). Pass via --build-arg or compose.
ARG VITE_SITE_URL
ARG VITE_GITHUB_URL
ARG VITE_GITHUB_LABEL
ARG VITE_PRODUCT_NAME
ARG VITE_SITE_TAGLINE
ARG VITE_MAINTAINER_NAME
ARG VITE_MAINTAINER_URL
ARG VITE_HOMEPAGE_URL
ARG VITE_HOMEPAGE_LABEL
ARG VITE_CONTACT_EMAIL
ARG VITE_FOOTER_NOTE
ENV VITE_SITE_URL=$VITE_SITE_URL \
    VITE_GITHUB_URL=$VITE_GITHUB_URL \
    VITE_GITHUB_LABEL=$VITE_GITHUB_LABEL \
    VITE_PRODUCT_NAME=$VITE_PRODUCT_NAME \
    VITE_SITE_TAGLINE=$VITE_SITE_TAGLINE \
    VITE_MAINTAINER_NAME=$VITE_MAINTAINER_NAME \
    VITE_MAINTAINER_URL=$VITE_MAINTAINER_URL \
    VITE_HOMEPAGE_URL=$VITE_HOMEPAGE_URL \
    VITE_HOMEPAGE_LABEL=$VITE_HOMEPAGE_LABEL \
    VITE_CONTACT_EMAIL=$VITE_CONTACT_EMAIL \
    VITE_FOOTER_NOTE=$VITE_FOOTER_NOTE

RUN pnpm --filter @animaku/web build \
 && pnpm --filter @animaku/server build

# ---- runtime (node dist only; no tsx / no full monorepo src) ----
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    WEB_DIST=public

WORKDIR /app

# Bundled server is self-contained; only need the JS + SPA assets (no sourcemaps)
COPY --from=build --chown=node:node /app/apps/server/dist/index.js ./dist/index.js
COPY --from=build --chown=node:node /app/apps/web/dist ./public

USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# cwd=/app so WEB_DIST=public and resolveWebRootRel finds ./public
CMD ["node", "dist/index.js"]
