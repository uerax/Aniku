<div align="center">

  <p><a href="README.md">简体中文</a> · <a href="README.en.md">English</a></p>

  <h1>Animaku</h1>

  <img src="apps/web/public/android-chrome-512x512.png" width="160" alt="Animaku logo" />

  <p>
    <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React" />
    <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Vite-6-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
    <img src="https://img.shields.io/badge/Hono-API-E36002?style=for-the-badge&logo=hono&logoColor=white" alt="Hono" />
  </p>

  <p>
    An anime streaming app for the browser: pick your source and play based on
    custom rules, backed by
    <a href="https://bangumi.tv/">Bangumi</a> metadata and
    <a href="https://www.dandanplay.com/">DanDanPlay</a> danmaku.<br />
    Compatible with <a href="https://github.com/Predidit/KazumiRules">KazumiRules</a> —
    import rules or install them from the rule store.
    Local watch history / follow lists, Anime4K upscaling. Actively in development (～￣▽￣)～
  </p>

  <p>
    <img
      src="docs/screenshots/watch-player.png"
      alt="Animaku player page: danmaku, multi-source episode picker and player controls"
      width="900"
    />
  </p>

</div>

## What is this

**Animaku** is a self-hosted web client built as a **React SPA + local Hono API**.

| Capability | Description |
|------|------|
| Metadata | Bangumi search / calendar / detail / episodes; optional Token to sync your follow list |
| Source-based playback | Compatible with Kazumi rules (XPath / API); multi-source episode picker |
| Danmaku | DanDanPlay matching; Bilibili BV; drag & drop bilibili / pakku XML |
| Local data | History, settings and rule JSON all live in the browser; the server persists no user content |

There is no embedded WebView media interception. Playback URLs are primarily resolved server-side for static m3u8/mp4; when extraction fails, playback falls back to embedding the source page in an iframe (cross-origin, danmaku and resume features are then limited).

## Supported environments

- **Browsers**: modern Chromium / Firefox / Safari (playback, HLS, optional WebGPU upscaling)
- **Deployment (recommended)**: Docker / Compose single container — **Docker only, no Node / pnpm needed**
- **Local production / development**: Node.js ≥ 20 (LTS recommended) + pnpm **9.15.0**

## Features

- [x] Anime home / catalog / search
- [x] Broadcast schedule
- [x] Anime details and episodes
- [x] Multiple video sources / multi-source episode picker
- [x] Custom rule import and rule store
- [x] Rule smoke testing (search → chapters → resolve)
- [x] Native `<video>` + hls.js player
- [x] DanDanPlay danmaku with panel / offset / hotkeys
- [x] Bilibili BV danmaku and local XML import
- [x] Follow list (Bangumi favorites, requires Token)
- [x] Watch history and resume playback
- [x] Playback speed / auto-next episode / skip OP·ED
- [x] Light & dark theme
- [x] HLS ad segment filtering
- [x] Anime4K real-time upscaling (WebGPU, efficiency / quality presets)
- [x] Media proxy with direct-connect fallback; iframe degradation
- [x] One-click Docker deployment
- [ ] And more to come (/・ω・＼)

## Quick start

For most users, **installing Docker is all you need**; the pnpm instructions below are only for local production or secondary development.

### One-click deployment with Docker (recommended)

```bash
git clone https://github.com/uerax/Animaku.git animaku
cd animaku

cp .env.example .env    # adjust PORT, PUBLIC_PROXY, etc. as needed
docker compose up -d --build
```

Open **http://localhost:$PORT** in your browser (default `8787`).  
A single container serves both the SPA and `/api/*` (same origin).

```bash
docker compose logs -f
docker compose down
```

```bash
# without compose
docker build -t animaku .
docker run --rm -p 8787:8787 --env-file .env -e PORT=8787 -e PUBLIC_PROXY=1 animaku
```

- Health check: `GET /api/health`
- `WEB_DIST=public` inside the image; the process runs as non-root (`node`)
- `PUBLIC_PROXY` is **enabled by default** (public internet can pick sources / use the proxy); set `0` to restrict to your local network
- `VITE_*` footer variables are build-time: changes require `docker compose up -d --build` to take effect

### Local Node production (no Docker)

A single process serves both `/api/*` and the SPA (same origin, no Vite proxy needed):

```bash
# Requires Node ≥ 20 + pnpm 9.15.0, run from the repo root
pnpm install
cp .env.example .env   # adjust as needed
pnpm start:prod
# equivalent: pnpm build && pnpm start
```

Open **http://localhost:$PORT** in your browser (default `8787`).  
`WEB_DIST` can point to a static directory (relative to the process cwd); locally it may be omitted — `public` / `apps/web/dist` etc. are auto-detected.

### Local development (pnpm)

| Tool | Version |
|------|------|
| Node.js | ≥ 20 (LTS recommended) |
| pnpm | **9.15.0** (matches the `packageManager` field) |

```bash
# Install pnpm (pick one)
npm install -g pnpm@9.15.0
# or: corepack enable && corepack prepare pnpm@9.15.0 --activate
```

Use pnpm from the **repo root**; don't install dependencies directly with npm / yarn.

```bash
pnpm install
cp .env.example .env   # adjust as needed

pnpm dev
```

| Process | Default address | Description |
|------|----------|------|
| Web (Vite) | http://localhost:5173 (`WEB_DEV_PORT`) | **Only open this in your browser** |
| API (Hono) | http://localhost:8787 (`PORT`) | Vite proxies `/api` to it |

```bash
pnpm dev:web       # frontend only
pnpm dev:server    # backend only
pnpm typecheck     # repo-wide tsc
```

Running `pnpm dev` without `pnpm install` first will fail with `tsx` / `node_modules missing`.  
For everyday development use `pnpm dev`, not the production `start` command.

## Usage

1. Docker / local production: http://localhost:$PORT · development: http://localhost:$WEB_DEV_PORT
2. **Settings → Bangumi Token** (optional, for the follow list)
3. Rules: several are built in by default (`Anime1` / `otage` / `xifan` / `MXdm`); import JSON or install from the **rule store**
4. Detail page → pick a source → select and play an episode (directly connects to the CDN when a direct link is available, automatically falls back to the media proxy on failure)
5. Danmaku is matched automatically on the player page; open the panel via the「幕」button in the control bar

### Playback hotkeys

| Key | Action |
|----|------|
| Space / K | Play / pause |
| ← / → | ±5s |
| ↑ / ↓ | Volume |
| F | Player fullscreen |
| D | Toggle danmaku |
| `,` / `.` / `/` | Danmaku delay / advance / reset offset |
| Alt+M | Danmaku panel |
| P / N | Previous / next episode |
| Drag & drop `.xml` | Import bilibili / pakku danmaku |

The control bar also has **page fullscreen** (CSS-fill, not the Fullscreen API).  
Settings page: default speed, auto-next episode, resume, skip OP/ED, upscale preset, force ad filtering / media proxy, etc.

## Environment variables

See [.env.example](.env.example) for the fully commented list. The server loads from the repo root and `apps/server`; Vite reads the same root `.env`.

### Common

| Variable | Default | Description |
|------|------|------|
| `PORT` / `HOST` | `8787` / `0.0.0.0` | API / production single-process listening |
| `WEB_DEV_PORT` / `WEB_HOST` | `5173` / code default `127.0.0.1` | **Local Vite only**; not used in Docker production |
| `DANDAN_APP_ID` / `DANDAN_APP_SECRET` | empty | When empty, a built-in legacy client key is used, so danmaku works out of the box |
| `BANGUMI_USER_AGENT` / `PRODUCT_USER_AGENT` | `animaku/0.1` | Upstream user agent |

### Footer / project promo (optional, Vite `VITE_*`)

The bottom of non-watch pages shows GitHub and optional maintainer info; after changes you need to re-run `pnpm build` / restart `pnpm dev`.

| Variable | Description |
|------|------|
| `VITE_GITHUB_URL` | Source URL (default `https://github.com/uerax/Animaku`); `owner/repo` also works |
| `VITE_MAINTAINER_NAME` / `VITE_MAINTAINER_URL` | Maintainer display name and homepage link |
| `VITE_HOMEPAGE_URL` / `VITE_CONTACT_EMAIL` | Extra homepage, contact email |
| `VITE_SITE_TAGLINE` / `VITE_FOOTER_NOTE` | Tagline and additional note |

See [.env.example](.env.example) for the full list.

### SEO (optional)

The SPA ships default `index.html` meta, client-side per-route title/description/OG updates, plus `/robots.txt` + `/sitemap.xml`.

| Variable | Description |
|------|------|
| `SITE_URL` | Runtime public origin (no trailing slash), written into the sitemap / robots `Sitemap:` |
| `VITE_SITE_URL` | Written into the client at build time, for canonical / `og:url` (requires rebuild in Docker) |

When unset: the server uses the request `Host` (incl. `X-Forwarded-*`); the client uses `window.location.origin`.  
Private pages (settings / history / follow / search / `/play/*`) are `noindex`; anime details are indexed at `/subject/:id`.

### Public / proxy access (important)

| Variable | Description |
|------|------|
| `PUBLIC_PROXY` | **Default `1`**: any client may use the media proxy and rule search/chapters/resolve. Set `0` to restrict to local / LAN only (or `PROXY_TOKEN`) |
| `PROXY_TOKEN` | Optional; when `PUBLIC_PROXY=0`, allows access via the `X-Animaku-Proxy-Token` header or `?proxyToken=` |
| `CORS_ORIGINS` | Additional allowed browser origins (comma-separated); localhost always works |

**Defaults are already suited for public VPS deployment.** When enabled, others may borrow your server's egress to pull streams — be aware of the bandwidth cost (internal SSRF blocking is still in place).  
If you only use it locally / on a LAN and don't want a publicly exposed port used as an egress relay, set `PUBLIC_PROXY=0`.

## Q&A

<details>
<summary>User Q&A</summary>

#### Q: Why do a few anime contain ads?

A: This project does not insert ads. Ads on the source side may come from m3u8 segments; you can enable **ad filtering** in the rule or settings (based on an `#EXT-X-DISCONTINUITY` heuristic, not a general ad blocker). Filtering has no effect without DISCONTINUITY markers or when using the iframe fallback.

#### Q: Why is playback choppy after enabling upscaling?

A: Anime4K runs on the browser **WebGPU**, which is demanding on the GPU. Prefer the **efficiency** preset over the quality one, or use it on lower-resolution sources; turn it off if WebGPU is unsupported.

#### Q: Why can some sources be found but not played?

A: The web client has no WebView interception capability and can only statically extract links. A large number of `resolve` failures is usually a parsing limit — switch rules / sources, or accept the iframe fallback (danmaku and some playback enhancements are unavailable).

#### Q: The page opens publicly but I can't pick a source / play?

A: Check whether `.env` / environment variables set `PUBLIC_PROXY` to `0`. The default should be `1`; if you deliberately tightened it, switch back to `1` or configure `PROXY_TOKEN`.

#### Q: Danmaku shows "not configured"?

A: You can leave `DANDAN_*` empty locally to use the built-in key. If it still fails, check `/api/danmaku/status` and the server logs; for production, consider applying for a key on the [DanDanPlay open platform](https://www.dandanplay.com/).

#### Q: I get sound but no picture?

A: This is usually a layout / compositing issue (e.g. a parent `overflow` + border-radius overlapping hardware-decoded video). See [docs/CONTEXT.md](docs/CONTEXT.md).

</details>

<details>
<summary>Rules & deployment Q&A</summary>

#### Q: Docker homepage returns 404?

A: Make sure the image build includes the frontend SPA; `WEB_DIST=public`, and confirm `GET /api/health` works.

#### Q: `pnpm: command not found` / `node_modules missing`?

A: pnpm is only needed for local Node / development. Install pnpm 9.15.0 and run `pnpm install` from the **repo root**. If you only want to deploy, use the Docker instructions above. Don't start only `dev:web` and expect `/api` to work.

#### Q: A custom rule finds results but can't play?

A: Some sites have anti-scraping / CAPTCHAs / hotlink protection that break static parsing. Switch sources, or rely on the iframe fallback for better compatibility (weaker than direct playback).

</details>

## Disclaimer

This software is provided "as is", without any express or implied warranty of suitability, reliability or accuracy on the part of the author or contributors. To the maximum extent permitted by law, the author is not liable for any direct or indirect damage arising from the use of this software.

Use of this project must comply with the laws and regulations of your location and must not infringe third-party intellectual property rights. Data and caches generated through use should be cleaned up in a timely manner; obtaining authorization from rights holders is your responsibility for long-term caching or redistributing third-party content.

Only a few sample rules are included by default; install more from [KazumiRules](https://github.com/Predidit/KazumiRules) or import your own. Some sites have anti-scraping / CAPTCHAs / hotlink protection, and the web client may fail to resolve them.

## Privacy

- No user telemetry is collected; no built-in analytics SDK.
- Bangumi Token, rule JSON, history and settings are stored **only in the browser** (`localStorage`, etc.).
- Server-side proxy requests access third-party sites and media CDNs per the rules; `PUBLIC_PROXY` is enabled by default — be aware of egress traffic and access control (set `0` to restrict to your LAN).

## Acknowledgements

Special thanks to [Kazumi](https://github.com/Predidit/Kazumi) and [KazumiRules](https://github.com/Predidit/KazumiRules) — an important reference for the rule model, source picking and product form.

Special thanks to [agefans-enhance](https://github.com/IronKinoko/agefans-enhance) and [@ironkinoko/danmaku](https://github.com/IronKinoko/danmaku) — an important reference for danmaku interaction and the player panel.

Special thanks to the [DanDanPlay](https://www.dandanplay.com/) open platform for providing danmaku capability.

Special thanks to the [Bangumi](https://bangumi.tv/) open API for providing anime metadata.

Special thanks to [Anime4K](https://github.com/bloc97/Anime4K) for providing the real-time upscaling algorithm and implementation reference.

Thanks to [hls.js](https://github.com/video-dev/hls.js/), [Hono](https://hono.dev/), [Vite](https://vitejs.dev/) and the React ecosystem, as well as everyone who contributes to this project and the upstream ecosystem.
