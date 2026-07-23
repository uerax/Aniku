# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Human-oriented project context** (architecture, decisions, pitfalls for all developers): **[docs/CONTEXT.md](docs/CONTEXT.md)**. Keep that file and this one aligned when changing critical behavior.

Product name: **Aniku**. Packages: `aniku`, `@aniku/web`, `@aniku/server`, `@aniku/shared`.

## Project overview

**Aniku** is a browser-only anime app (React + local Hono API). Features: Bangumi metadata & collections, user-imported plugin rules (KazumiRules-compatible JSON) for search/chapters/play resolution, HLS/MP4 playback, DanDanPlay danmaku, local watch history.

Ships working default rules under `apps/web/src/data/default-plugins/` (`7sefun`, `MXdm`). Users can import JSON, reset to defaults, or install/update from [KazumiRules](https://github.com/Predidit/KazumiRules) via server proxy (`GET /api/plugin/catalog`).

## Sibling reference repos (workspace, optional)

Parent directory may still contain older reference clones (read-only if present):

| Path | Role |
|------|------|
| this repo (`aniku` / folder may still be `Kazumi-web` on disk) | full read/write |
| `Kazumi/` | optional Flutter reference for rule/search UX |
| `agefans-enhance/` | optional userscript reference for danmaku/player |

Do not modify sibling reference trees. Copy patterns, not files wholesale.

## Commands

Requires **Node ≥ 20** and **pnpm 9.15.0** (`packageManager` field).

```bash
pnpm install

# Dev: web + server together (ports from .env WEB_DEV_PORT / PORT)
pnpm dev

# Individual packages
pnpm dev:web          # Vite only
pnpm dev:server       # Hono only (tsx watch)

pnpm build            # all packages (web: tsc + vite build; server: tsc --noEmit)
pnpm typecheck        # recursive tsc
pnpm lint             # same as typecheck (tsc only; no ESLint)

# Filter a single package
pnpm --filter @aniku/web typecheck
pnpm --filter @aniku/server typecheck
pnpm --filter @aniku/shared typecheck
```

There is **no unit/integration test runner** in the repo today. Validation is `pnpm typecheck` / package `lint` (tsc) and manual flows via `pnpm dev`.

### Env

```bash
cp .env.example .env
```

Loaded by `apps/server/src/config.ts` from repo root and `apps/server` (custom parser, not dotenv).

| Variable | Purpose |
|----------|---------|
| `PORT` / `HOST` | API listen (default `8787` / `0.0.0.0`) — `apps/server/src/config.ts`; Docker container listen |
| `WEB_DEV_PORT` / `WEB_HOST` | Vite local dev/preview listen only (default `5173` / `127.0.0.1` if unset) — `apps/web/vite.config.ts`. Not used by production Docker / single-process `pnpm start` (browser uses `PORT`) |
| `WEB_HMR_HOST` | Optional HMR websocket host when `WEB_HOST` is `0.0.0.0` (default `127.0.0.1`) |
| `API_PROXY_HOST` / `API_PROXY_TARGET` | Optional Vite `/api` proxy target (default `http://127.0.0.1:$PORT`) |
| `DANDAN_APP_ID` / `DANDAN_APP_SECRET` | Optional open-platform keys; empty → built-in legacy client headers so danmaku works out of the box |
| `BANGUMI_USER_AGENT` | UA for Bangumi upstream; default `aniku/0.1` |
| `PRODUCT_USER_AGENT` | Product identity UA (DanDanPlay etc.); default `aniku/0.1` |
| `DEFAULT_USER_AGENT` | Browser-like UA for plugin HTML / media fetches |

Server loads `.env` from repo root / `apps/server` (`config.ts`). Vite loads the same root `.env` via `loadEnv` and binds/proxy from those vars — **no hardcoded ports in config**.

**No `DPLAYER_API` / public DPlayer danmaku pool** — that service is dead and was removed.

## Monorepo layout

```
apps/web/           @aniku/web     React 19 + Vite 6 + Tailwind 4 + TanStack Query + Zustand
apps/server/        @aniku/server  Hono on @hono/node-server
packages/shared/    @aniku/shared  Types + parsers (source-exported TS, no build step)
```

Workspace: `pnpm-workspace.yaml` → `apps/*`, `packages/*`. Internal deps use `workspace:*`.

Shared is consumed as raw TypeScript (`exports: "./src/index.ts"`). Change types/DTOs in `packages/shared/src/` (`plugin.ts`, `bangumi.ts`, `danmaku.ts`, `history.ts`, `api.ts`, `player.ts`); both apps import `@aniku/shared`.

## Architecture

### Request flow

```
Browser (WEB_DEV_PORT, default 5173)
  ├─ Bangumi UI ──GET/POST /api/bangumi/*──► server (PORT, default 8787) ──► api.bgm.tv / next.bgm.tv
  ├─ Danmaku    ──GET /api/danmaku/*───────► server ──► api.dandanplay.net
  ├─ Plugins    ──POST /api/plugin/*───────► rule-engine ──► third-party site HTML
  └─ Playback   ──GET /api/media/proxy?url=► server streams m3u8/mp4 (rewrites m3u8 URIs)
```

Server entry: `apps/server/src/index.ts` mounts routes under `/api/{bangumi,danmaku,plugin,media}` plus `/api/health`.

### Frontend

| Area | Location |
|------|----------|
| Routes | `apps/web/src/App.tsx` — `/`, `/timeline`, `/search`, `/subject/:id`, `/play/:id`, `/collect`, `/history`, `/settings` |
| Pages | `apps/web/src/pages/*` |
| API clients | `lib/api.ts` (fetch + `ApiError`), `lib/bangumi.ts`, `lib/plugin-api.ts` |
| State | Zustand + `localStorage`: `stores/settings.ts` (Bangumi token, danmaku + player prefs), `stores/plugins.ts` (rules), `stores/history.ts` (progress) |
| Player | `player/VideoPlayer.tsx` — see **Player & danmaku** below |

Server state for lists/detail uses TanStack Query; plugin rules and history are client-persisted only.

**User data boundaries:** Bangumi Access Token and plugin JSON live in the browser. The server never stores them; each plugin call posts the full `rule` object.

### Plugin / rule engine (critical path)

1. **Defaults / import / shop** — First load seeds `DEFAULT_PLUGIN_RULES`. Settings can import JSON (`POST /api/plugin/validate` + `importRule`), or list/download from KazumiRules (`GET /api/plugin/catalog`, `GET /api/plugin/catalog/:name` with optional `?mirror=1`).
2. **Search** — Subject page fans out enabled plugins → `POST /api/plugin/search` → `searchWithRule` in `apps/server/src/rule-engine/index.ts` (XPath via cheerio→xml→xmldom + xpath; cheerio card fallback).
3. **Chapters** — `POST /api/plugin/chapters` → `chaptersWithRule` (roads of episode page URLs).
4. **Resolve** — Play page → `POST /api/plugin/resolve` → scrape play page for m3u8/mp4 (regex + iframe/`player_aaaa` heuristics) → returns `playUrl` + `proxyUrl`.
5. **Play** — Video src is the media proxy URL (CORS / referer).

Play sidebar episode list is cached in `sessionStorage` as `roads:{bangumiId}:{pluginName}` from the subject page — not re-fetched from episode URL alone.

#### Search compatibility (Kazumi-style, intentional limits)

Kazumi does **not** fuzzy-match titles inside XPath. Site search is exact `@keyword` substitution; title variance is handled in the **UI** (别名 / 手动关键词). This project mirrors that:

| Layer | Behavior |
|-------|----------|
| Shared `buildSearchKeywords(nameCn, name, aliases?)` | Short heads first, strip brackets / 第N期 / S2, max length 48 |
| Shared `titleSimilarity` / `rankSearchItems` / `bestTitleSimilarity` | Rank hits closer to Bangumi titles; **user still picks the card** |
| Shared `parseBangumiAliases` | Bangumi infobox key `别名` → `BangumiItem.alias` |
| Server `expandKeywordCandidates` | Up to 4 short variants of a single keyword; try until hits |
| Subject page | Per-plugin fan-out + gen cancel; **别名检索** / **手动检索**; “相近” badge |

**WebView parity:** Resolve is still static HTML first (m3u8/mp4 extraction). When resolve fails, PlayPage falls back to **iframe-embedding the source `pageUrl`** (`EmbedPlayer`) so the site's own player JS can run in the browser. That is **not** desktop WebView: cross-origin blocks media intercept, danmaku sync, and many sites forbid framing (`X-Frame-Options` / CSP). Prefer 换规则 for native player; iframe is a degraded path only.

#### Soft-fail & media heuristics (keep these)

- **Search:** finished parse with empty `items` → **HTTP 200** + `diagnostics` (dead site / no hits must not 502 the whole subject UI). Network errors on last candidate still soft-empty when possible.
- **Resolve:** `scoreMediaUrl` prefers **m3u8** over signed progressive mp4 (qq photo / `dis_k` often expire → 404). Prefer re-click episode over caching short-lived CDN URLs long-term.
- **Media proxy:** upstream 403 may retry without some headers; 404/502 surfaces clear message. Private-host block stays in `routes/media.ts`.

### Bangumi

Server normalizes upstream JSON with shared parsers (`parseBangumiItem`, collection type maps). List endpoints slim heavy fields. Auth: browser sends `Authorization: Bearer <token>`; server forwards to Bangumi.

### Player & danmaku

**Split responsibilities (do not re-merge):**

```
Native <video>   → chrome: custom control bar (play/seek/vol/speed/SR/fs); decode + audio
hls.js           → HLS attach on the same <video> (DPlayer-equivalent path)
Anime4K (opt)    → WebGPU canvas overlay (`player/anime4k.ts`); default off
@ironkinoko/danmaku → overlay layer (pointer-events:none) over video
DanDanPlay API   → comments via /api/danmaku/* (+ optional bilibili BV proxy)
```

**Do not reintroduce Plyr or DPlayer** for playback chrome. Both were tried and abandoned:

| Approach | Failure mode |
|----------|----------------|
| DPlayer public danmaku pool | Service dead; never configure `danmaku` / `apiBackend` |
| Plyr + hls.js | Black frame with audio still playing; MSE blob torn by remount / `blankVideo`; layout fights |
| Nested `overflow-hidden` + `rounded-*` around HW `<video>` | **Chrome: audio OK, picture black** — especially SubjectPage wrapper |

#### Correct media pipeline

1. Stable React host: fixed `<video ref>` in shell (do not let a UI library reparent the media element).
2. `Hls.loadSource(proxyUrl)` + `hls.attachMedia(video)` when URL is m3u8; else `video.src = …`.
3. After `MANIFEST_PARSED` / `loadedmetadata`: resume seek, then `play()` (muted-first if autoplay policy blocks).
4. Danmaku: create ironkinoko on a transparent overlay **after** play starts a frame; `BASE_DANMAKU_SPEED = 130` × user speed; `reload` when comments/settings change.
5. `src` change: destroy hls → destroy danmaku core → stop Anime4K → new attach. Use a generation token so stale callbacks no-op.

Proxy URL comes from resolve (`/api/media/proxy?url=…&referer=…`). Segment 200s in server logs mean the stream works even if the UI was black.

#### Super-resolution (Anime4K / WebGPU)

- `PlayerSettings.superResolution`: `off` | `efficiency` | `quality` (default `off`).
- Module: `apps/web/src/player/anime4k.ts` + dynamic `import('anime4k-webgpu')` — **no GPU / no package load when off**.
- Video stays decoder+audio; canvas paints SR; shell class `kz-sr-on` hides video picture via opacity.
- Must own stop/destroy (upstream `render()` has no teardown). Need WebGPU; disable UI if missing. No SR on iframe embed; iOS system video FS won't show canvas (use webpage FS).

#### Layout / CSS hazards (keep fixed)

- **Never** wrap the player in an extra parent with `overflow-hidden` + `border-radius` while the video is `absolute inset-0` / hardware-decoded. PlayPage was fine; SubjectPage used that pattern and blacked out.
- Prefer **same structure as PlayPage**: `VideoPlayer` owns `aspect-video` + optional `rounded-2xl`; do **not** use `embedded` fill-parent under a clipping shell.
- Shell CSS: avoid `isolation: isolate` over video; neutralize ironkinoko `.danmaku-stage { transform: translateZ(0) }` (can blank the video layer). Styles live in `apps/web/src/player/plyr-overrides.css` (name is historical — native player now).
- Overlay layers (status, drop, panel) must use `pointer-events: none` on full-screen wrappers; only the actual panel/controls capture clicks.

#### Dev remount

`apps/web/src/main.tsx` intentionally **omits React StrictMode** in dev: double-mount tears down HLS MSE mid-load (`blob: … ERR_FILE_NOT_FOUND`) and looks like “can’t play”. Production single-mount is fine.

#### Danmaku features

- **Panel** (`DanmakuPanel.tsx`): tabs 搜索 / 设置 / 导入. Must pass `danmakuPanel` prop from **both** `PlayPage` and `SubjectPage` (SubjectPage was missing it → no 「幕」 button).
- **Import:** local bilibili/pakku XML (`parseDanmakuXml`), BV via `GET /api/danmaku/bilibili?bvid=…&p=…` (`bilibili-danmaku.ts`).
- **Settings:** opacity / fontSize / speed / area / timeOffset / type filters / keyword filters; store in Zustand `danmaku`.
- **Auto-match:** bgm map + title search in parallel; do not clear comments until new load succeeds; never block video resolve.

#### Fullscreen (control bar direct buttons — no nested menu)

| Mode | Mechanism |
|------|-----------|
| 全屏 | `shell.requestFullscreen()` — **F** toggles this |
| 网页全屏 | CSS class `kz-web-fs` fixed full viewport (no Fullscreen API) |
| 退出 | same button again, **F**, or **Esc** (web-fs); browser Esc for Fullscreen API |

**Removed:** 浏览器全屏 (`document.documentElement.requestFullscreen`).

**Sizing:** default shell uses `.kz-player-frame` — 16:9, `max-width/max-height` capped by `100dvh - 11rem` so small laptop windows don't overflow.

#### Hotkeys (player focus; skip when typing in inputs)

| Key | Action |
|-----|--------|
| Space / K | play / pause |
| ← / → | seek ±5s |
| ↑ / ↓ | volume |
| F | player fullscreen toggle |
| D | danmaku on/off |
| **`,`** | danmaku lag +0.5s (`timeOffset += 0.5`) |
| **`.`** | danmaku advance −0.5s (`timeOffset -= 0.5`) |
| **`/`** | danmaku offset reset to 0 |
| Alt+M | open/close danmaku panel |
| P / N | prev / next episode |
| Esc | close menus; exit webpage FS |

OP/ED skip: `PlayerSettings.skipOp` / `skipEd`; when `skipEd.start === 0`, treat as last N seconds of video.

#### DanDan credentials

`DANDAN_*` env optional. Empty → same built-in AppId/Secret as agefans-enhance, **legacy headers** `X-AppId` / `X-AppSecret` (`lib/dandan.ts`). User-supplied keys → open-platform `X-Auth` + signature. `/api/danmaku/status` always `configured: true` when fallback exists.

## Conventions worth knowing

- **Chinese UI copy** is intentional for end-user strings.
- **Plugin rule fields** mirror Kazumi JSON (`baseURL`, `searchURL` with `@keyword`, XPath `searchList` / `searchName` / `searchResult` / `chapterRoads` / `chapterResult`). **API mode** (`searchMode`/`chapterMode: 'api'`) is supported via `searchApiConfig` / `chapterApiConfig` (e.g. catalog rules **sorani**, **TvTFun**); XPath-only fields may be empty for those.
- **Media proxy** blocks private hosts (`routes/media.ts`); plugin HTML fetch (`fetchHtml`) is a separate path — keep security behavior consistent if changing either.
- Root scripts use `pnpm -r` / `--filter`; prefer those over ad-hoc `cd` into packages.
- Default rules mirror Kazumi `assets/plugins/*` only; extra sources come from user import or the KazumiRules catalog proxy — do not hardcode a large site list into the product.
- Positional XPath `//div[n]` is fragile across cheerio→xml vs browser DOM; cheerio card fallback exists for a reason — prefer fixing fallbacks / keywords over inventing engine-side fuzzy XPath.

## Key modules (quick map)

| Concern | Primary files |
|---------|----------------|
| Keyword / rank helpers | `packages/shared/src/plugin.ts` |
| Bangumi aliases | `packages/shared/src/bangumi.ts` (`parseBangumiAliases`) |
| Player prefs | `packages/shared/src/player.ts` |
| Rule engine | `apps/server/src/rule-engine/index.ts` (+ `api.ts` for `searchMode/chapterMode: 'api'`) |
| Plugin HTTP | `apps/server/src/routes/plugin.ts` (search soft-200) |
| Media proxy | `apps/server/src/routes/media.ts` |
| Danmaku proxy | `apps/server/src/routes/danmaku.ts` + `lib/dandan.ts` |
| Bilibili BV danmaku | `apps/server/src/routes/bilibili-danmaku.ts` → `GET /api/danmaku/bilibili` |
| XML parse | `packages/shared/src/danmaku.ts` (`parseDanmakuXml`, `extractBvid`) |
| Subject search UX | `apps/web/src/pages/SubjectPage.tsx` |
| Playback shell | `apps/web/src/pages/PlayPage.tsx` |
| Player + danmaku layer | `apps/web/src/player/VideoPlayer.tsx` (native video + hls.js) + `DanmakuPanel.tsx` + `anime4k.ts` + `plyr-overrides.css` |
| Default rules | `apps/web/src/data/default-plugins/` |
| App entry (no StrictMode) | `apps/web/src/main.tsx` |

## Session lessons (2026-07 — keep)

1. **Subject black / Play OK** → check for wrapper `overflow-hidden rounded-*` around the player, not the stream.
2. **Audio without video** → compositing (overflow/radius/isolation/danmaku stage transform), not m3u8 404.
3. **`.ts` proxy 200 spam** while black → pipeline OK; fix UI stacking / player chrome.
4. **Danmaku “not configured”** with empty `.env` → ensure `dandan.ts` fallback + status route still ships.
5. **Always wire `danmakuPanel` on SubjectPage** if the control bar should show 「幕」.
6. **Do not bring back Plyr** without a full isolation plan for MSE + remount.
