# Animaku 项目状态

## [2026-07-28] 轻量页取消路由 lazy

- 状态：已完成
- 优先级：P1
- 描述：Home/Anime/Timeline/Search/Collect/History/Settings 改为静态 import，避免导航 RTT。仅 subject/play 保留 lazy + 局部 Suspense。播放器/hls/anime4k 仍按原 lazy。
- 涉及文件：apps/web/src/App.tsx
- 备注：typecheck + build 通过；主 index ~92KB / gzip ~30KB（原 ~49/17）；无独立 HomePage 等小 chunk

## [2026-07-28] 弹幕改为 CDN 头、撤销源站内存缓存

- 状态：已完成
- 优先级：P1
- 描述：撤销 danmaku 进程内 cacheGetOrSet；成功响应设
  `Cache-Control: public, max-age=0, s-maxage=1800` +
  `CDN-Cache-Control` / `Cloudflare-CDN-Cache-Control: max-age=1800`（30min 边缘）。
  `?refresh=1` → no-store。浏览器 max-age=0 不囤大 body。
  **仅改头不够**：CF 默认不缓存 /api，需 Cache Rule 允许这些路径。
- 涉及文件：cdn-cache-headers.ts（新）、routes/danmaku.ts、bilibili-danmaku.ts、ttl-cache 去掉 DANMAKU_*
- 备注：server typecheck 通过；/status 仍无缓存头

## [2026-07-28] 弹幕/Anime4K 延后初始化（A+B）

- 状态：已完成
- 优先级：P1
- 描述：仅 VideoPlayer 热路径时序，不改选源/接口。
  - A：`danmakuMediaReadyRef`；无引擎时需 canplay / HAVE_CURRENT_DATA / noteDanmakuMediaReady 才 `new CanvasDanmaku`；src 切换重置；settings 仍走 ref，就绪后一次 apply
  - B：超分在 metadata 之后若仍 paused，等 `playing`（或 cancel）再 `startAnime4K`；off 不加载；提示「将在开始播放后启动」
- 涉及文件：apps/web/src/player/VideoPlayer.tsx
- 备注：web typecheck 通过；建议手测：开播弹幕出现、开播前改弹幕设置、续播/seek、换集、超分开着暂停首帧再播

## [2026-07-28] P1 CLS 骨架 + 播放器 chunk 预取

- 状态：已完成
- 优先级：P1
- 描述：对照 CWV 报告 CLS/INP；不碰选源/播放业务逻辑。
  1. `BangumiGridSkeleton` + `.kz-skeleton`：与网格同列距/3:4 占位；Home/Anime/Timeline/Search/Collect 加载态替换 LoadingState
  2. Watch 条目加载中：用 `kz-player-placeholder`（已有 16:9）+ meta 骨架，避免 main 从空文案暴涨
  3. `preloadVideoPlayer`：仅 dynamic import，卡片 hover/focus + Watch mount 预拉；不 new Hls/弹幕
- 涉及文件：ui.tsx、index.css、lazy.tsx、HomePage/AnimePage/TimelinePage/SearchPage/CollectPage、WatchPage
- 备注：web typecheck 通过；未改 focusAfterSelection / sourcesOpen / eps 行为

## [2026-07-28] P0 LCP 封面优化（Cloudflare CWV）

- 状态：已完成
- 优先级：P0
- 描述：对照 Cloudflare Web Analytics 报告，LCP Poor 主因是 `img.h-full.object-cover` + `lain.bgm.tv` 封面晚到/过大。
  1. `index.html` preconnect + dns-prefetch `lain.bgm.tv`
  2. `BangumiGrid` 前 12 张 eager，第 1 张 `fetchPriority=high`，其余 lazy 用 low
  3. `coverOf` 经 `preferResizedCover`：无 `/r/N/` 的 bgm `/pic/` 补 `/r/400`（thumb）或 `/r/800`（large）
  4. WatchMeta 桌面/移动简介图改 thumb，不再 large
- 涉及文件：apps/web/index.html、components/ui.tsx、pages/watch/WatchMeta.tsx、packages/shared/src/bangumi.ts
- 备注：shared/web tsc 通过；未做 CLS 骨架 / 播放器 INP（P1）

## [2026-07-28] SEO 实用层优化（无 SSR）

- 状态：已完成
- 优先级：P2
- 描述：
  1. `index.html` 补 description / robots / theme-color / OG / Twitter 默认；`site.webmanifest` 补 description/lang/start_url
  2. 客户端 `DocumentSeo` + `lib/seo.ts`：按路由 title/description/robots/canonical/OG/JSON-LD；`/subject/:id` 用 Bangumi 元数据；`/play` noindex 且 canonical 到 subject
  3. 服务端 Host 感知 `/robots.txt` + `/sitemap.xml`（`SITE_URL` 或请求 Host）；public 静态副本作 fallback
  4. `VITE_SITE_URL` / `SITE_URL` 写入 .env.example、Docker ARG/compose、README、CONTEXT
- 涉及文件：
  - apps/web：index.html、public/robots.txt、public/sitemap.xml、site.webmanifest、src/lib/seo.ts、components/DocumentSeo.tsx、Layout.tsx、vite-env.d.ts
  - apps/server：index.ts、config.ts、lib/seo-static.ts
  - Dockerfile、docker-compose.yml、.env.example、README.md、docs/CONTEXT.md
- 备注：web/server typecheck 通过；未做 SSR/预渲染；详情页对不执行 JS 的爬虫仍只有壳

## [2026-07-28] PUBLIC_PROXY 默认改为 1

- 状态：已完成
- 优先级：P1
- 描述：公网 VPS 部署实质必须开；默认 0 会导致「能开页不能选源」。`config.publicProxy` 默认 true；compose 已是 :-1；同步 .env.example / README / CONTEXT / access 403 文案 / 设置页展示。
- 涉及文件：apps/server/src/config.ts、lib/access.ts、.env.example、docker-compose.yml、README.md、docs/CONTEXT.md、SettingsPage.tsx
- 备注：MEDIA_FULL_PROXY 仍默认 0；设 PUBLIC_PROXY=0 可收紧为局域网

## [2026-07-28] Docker 部署文件优化

- 状态：已完成
- 优先级：P2
- 描述：
  1. compose：去掉错误 UA 默认 `animaku/0.1`（空则走 config.ts 正式 Bangumi UA）；显式透传 PUBLIC_PROXY / MEDIA_FULL_PROXY / PROXY_TOKEN / CORS_ORIGINS
  2. Dockerfile：修正 $WEB_PORT 注释；runner 只拷 index.js（无 map）；USER node + chown；health start_period 对齐 20s；VITE_* ARG/ENV 构建期注入
  3. compose build.args 透传 VITE_*；.env.example / README 补 Docker 公网与页脚 rebuild 说明
- 涉及文件：Dockerfile、docker-compose.yml、.env.example、README.md
- 备注：未改应用代码；未实测 docker build（环境若无 daemon 需用户本地验证）

## [2026-07-28] README 部署指南：Docker 前置

- 状态：已完成
- 优先级：P3
- 描述：避免用户只看前半段以为必须 pnpm。支持环境把 Docker 标为推荐；快速开始改为 Docker → 本机 Node 生产 → 本地开发；删独立「生产运行」节（内容并入快速开始）；部署 Q&A 把 Docker 404 提前，pnpm 说明改为「仅本机/开发需要」。
- 涉及文件：README.md
- 备注：内容未改命令本身，只调顺序与引导文案

## [2026-07-28] Bangumi API User-Agent 规范

- 状态：已完成
- 优先级：P3
- 描述：非浏览器调 Bangumi 须带「开发者 ID + 应用名」；开源附主页。默认 UA：`uerax/Animaku/0.1.0 (https://github.com/uerax/Animaku)`（项目已改名 Animaku，与 footer branding 一致）。`bangumiFetch` 始终注入。
- 涉及文件：apps/server/src/config.ts、.env.example、.env
- 备注：勿用 database / 仅 Bangumi/x.y；

## [2026-07-28] README 播放页截图

- 状态：已完成
- 优先级：P3
- 描述：将用户提供的播放页截图放入 `docs/screenshots/watch-player.png`，并在 README 居中头图区 logo/徽章/简介之后展示（width=900）。
- 涉及文件：docs/screenshots/watch-player.png、README.md
- 备注：命名 watch-player，与后续可能的 home/timeline 截图统一前缀风格

## [2026-07-28] 线路 tab 横滑修复

- 状态：已完成
- 优先级：P0
- 描述：>5 条线路时同 ep strip：flex min-content 撑开 + panel overflow-hidden 裁切，无法点后排。`.kz-bili-roads` 加 min-width:0 / width:100% / overflow-x:auto + 细滚动条；active 路 `scrollIntoView`。
- 涉及文件：index.css、MobileEpsSection.tsx
- 备注：与选集折叠横滑同根因

## [2026-07-28] 视频源卡现代化

- 状态：已完成
- 优先级：P2
- 描述：去掉大片浅蓝底。源行改为 elevated 小卡（细边框+轻阴影）；当前/待选仅 5–6% accent 淡底 + 2px 左边条；标签改 outline pill（当前非实心蓝块）；首字母 avatar；搜索钮实心 accent；命中行中性字色 + 播放中绿点式 live dot。逻辑未改。
- 涉及文件：index.css、WatchPage.tsx
- 备注：行为钩子不变

## [2026-07-28] 选集展开网格统一 4 列

- 状态：已完成
- 优先级：P2
- 描述：折叠横条约 4 卡观感确认合适；展开网格去掉桌面 3 列，统一 `repeat(4, minmax(0,1fr))`，与折叠密度一致。
- 涉及文件：index.css、MobileEpsSection.tsx
- 备注：行为钩子未改

## [2026-07-28] 选集折叠横滑修复 + 约 4 卡可视

- 状态：已完成
- 优先级：P0
- 描述：折叠条 flex min-content 撑满所有集卡，父 overflow-hidden 裁切 → 无法 overflow-x 滚动、后集不可达。修：strip/body `min-width:0`+`width:100%`+`overflow-x:auto`；卡 `flex-basis: calc((100% - 1.2rem)/4)`；细横滚动条可见。
- 涉及文件：index.css、MobileEpsSection.tsx、plyr-overrides.css
- 备注：展开已统一 4 列

## [2026-07-28] 视频源/选集 bilibili 正片侧栏重设计

- 状态：已完成
- 优先级：P2
- 描述：对照 bangumi play（ss44777）侧栏。共享 `.kz-bili-sec-*` 头栏；源为圆角 soft 行+左边条；关键词输入条。选集 soft pill 线路；横向圆角集卡；在播 accent-soft + 音浪。**未改** focusAfterSelection / sourcesOpen / epsListExpanded / 滚动 class / 4·3 列 / kz-kw 高度 / pick。
- 涉及文件：WatchPage.tsx、MobileEpsSection.tsx、index.css、plyr-overrides.css
- 备注：web tsc 通过；方格版已否决

## [2026-07-28] 首页滚动图片卡顿

- 状态：已完成
- 优先级：P0
- 描述：往下滚封面填充卡顿、往上滚上方图消失再加载。根因：`img { content-visibility: auto }` + `.bangumi-card` 的 content-visibility 滚出视口跳过绘制、滚回重绘；网格还用 `coverOf(..., 'large')` 加重解码。
- 改动：去掉全局/卡片 content-visibility；BangumiCard 改用 thumb（common/medium）；续播小图补 lazy/decoding/尺寸。
- 涉及文件：apps/web/src/index.css、components/ui.tsx、pages/HomePage.tsx
- 备注：未上虚拟列表（24–50 条不必）

## [2026-07-28] 观看页 W1–W3 面板美化

- 状态：已完成
- 优先级：P2
- 描述：简介/视频源/选集套 kz-watch-panel；meta chip（评分/更新至/标签）；源头栏字阶 + 源卡左边条；线路 pill tab；在播集卡 accent-soft；空态 step。**未改** focusAfterSelection / sourcesOpen / epsListExpanded / kz-watch-focus / 桌面 body 滚动 class / 4·3 列密度 / kw 高度 / 集名逻辑。
- 涉及文件：WatchMeta.tsx、MobileEpsSection.tsx、WatchPage.tsx、index.css、plyr-overrides.css
- 备注：web typecheck 通过；行为钩子 checklist 全 OK

## [2026-07-28] 分析 share.acgnx.se 资源接入可行性

- 状态：已完成（分析，未改代码）
- 优先级：P3
- 描述：评估 AcgnX（末日動漫資源庫）能否接入。结论：站点是 BT/magnet 索引，不是流媒体；与现有 Kazumi 插件管线（search→chapters→resolve→m3u8/mp4）模型不兼容。HTML 全站 Cloudflare 挑战；RSS（`/rss.xml?keyword=`、`/rss-N.xml`）可直拉且带 magnet enclosure。若要接，只能做「新表面」：RSS 搜索 + magnet 外抛/复制，不能当内置视频源播放。
- 涉及文件：无代码改动；架构见 packages/shared/src/plugin.ts、rule-engine、docs/CONTEXT.md
- 备注：详见本次对话分析

## [2026-07-28] P0 视觉抛光 1–4

- 状态：已完成
- 优先级：P2
- 描述：字体 Inter（Bunny CDN）+ 中文系统 fallback；深色离开纯黑、浅色暖灰底；kz-surface 阴影层级 + interactive hover；PageHeader 字阶加大、首页区块 kz-section-title、续播卡 surface、空/载/错态套 surface。
- 涉及文件：apps/web/index.html、index.css、components/ui.tsx、pages/HomePage.tsx
- 备注：web typecheck 通过；未引 UI 库；P1 未做

## [2026-07-28] 卡片「更新至N集 / 已完结」

- 状态：已完成
- 优先级：P2
- 描述：Bangumi 无官方播出状态枚举。解析并缓存 `eps`/`totalEpisodes`（v0 字段 + next `info` 的 `N话`/`YYYY年M月D日`）；卡片用首播日按周更估算进度。文案左下角徽章（右下仍为评分）。进度在渲染时算，不把「更新至」冻进 list TTL。
- 涉及文件：packages/shared/src/bangumi.ts、apps/web/src/components/ui.tsx
- 备注：typecheck shared/web/server 通过；不精确于非周更/延期；未接 episodes 精算

## [2026-07-28] 页脚 GitHub + 可配置维护者信息

- 状态：已完成
- 优先级：P2
- 描述：非观看页 SiteFooter — 参考 48.club 单行（产品·©·维护者 | 图标链），去掉免责/数据来源描述；VITE_*；默认 uerax/Animaku。观看页隐藏。
- 涉及文件：SiteFooter.tsx、site-branding.ts、Layout.tsx、vite-env.d.ts、.env.example、README、CONTEXT
- 备注：web typecheck

## [2026-07-28] 缓存小补丁 1+2+3

- 状态：已完成
- 优先级：P2
- 描述：
  1. SearchPage RQ staleTime 30m / gcTime 2h（对齐 browse）
  2. useWatchSession subject RQ staleTime 30m / gcTime 6h
  3. 服务端 GET /subjects/:id 进程内 TTL 6h + X-Cache + refresh 绕过；缓存完整 parseBangumiItem（非 slim）
- 涉及文件：ttl-cache.ts、routes/bangumi.ts、SearchPage.tsx、use-watch-session.ts、docs/CONTEXT.md、docs/TODO.md
- 备注：未做 episodes 缓存、未做 hover prefetch

## [2026-07-28] 基础页面功能/性能再评估（未改代码）

- 状态：已完成（分析）
- 优先级：P2
- 描述：首页/时间表/番剧/搜索/追番/历史/设置/观看壳。列表双层缓存、路由与播放器 lazy、卡片 memo+lazy img、历史 debounce 已到位。剩余多为 subject 详情缓存、追番分页、搜索 staleTime、预取等中低收益；不建议为 24–50 条网格上虚拟列表。功能缺口见 docs/TODO OP/ED。
- 涉及文件：pages/*、Layout、ui、bangumi routes、use-watch-session、stores
- 备注：见对话分析

## [2026-07-28] 弹幕性能再评估（未改代码）

- 状态：已完成（分析）
- 优先级：P2
- 描述：相对 07-26 桌面密集优化后的现状再评估。热路径（glyph atlas + lazy measure + in-place prune + soft cap + DPR clamp）仍在，不宜回退。尚有优化空间但多为次要/需 benchmark；高风险项（WebGL 重写、去掉 media-time、去掉 cap、全量 measure、每帧 filter）明确不碰。
- 涉及文件：canvas-danmaku.ts、danmaku-utils.ts、VideoPlayer.tsx、danmaku-pools.ts、use-danmaku-session.ts
- 备注：见对话分析；若落地优先低风险：contentKey 误触、glyph LRU 按字节、reload 时对象复用、clear 脏区/跳帧、cap 旁路 spawn 不推进 cursor

## [2026-07-28] 选集卡片缩小 + 只显示源站集名

- 状态：已完成
- 优先级：P1
- 描述：去掉「第 N 话」双行；卡片只显示 identifier 源站名（空则序号）。网格移动 4 列 / 桌面 rail 3 列；min-height 与 padding 压紧。
- 涉及文件：MobileEpsSection.tsx、plyr-overrides.css
- 备注：typecheck 通过；与「选源默认展开」一并体验

## [2026-07-28] 选源后选集默认「全 N 话」展开

- 状态：已完成
- 优先级：P1
- 描述：选中视频源后折叠视频源、选集默认网格展开（任意集数）；每源只自动展开一次，用户可再点「全N话」收起。避免长列表横滑条过长。
- 涉及文件：apps/web/src/pages/WatchPage.tsx
- 备注：typecheck 通过

## [2026-07-28] 设置面板 + MEDIA_FULL_PROXY 部署安全

- 状态：已完成
- 优先级：P0–P1
- 描述：TODO 2 — 规则本地校验；MEDIA_FULL_PROXY 默认 0（仅 m3u8）；fullProxy/cookie mp4 否决；Anime1 内置最后且 mediaFullProxy=0 时禁用；health/设置页只读展示；设置不可提权。
- 涉及文件：
  - apps/server/src/config.ts、index.ts、routes/media.ts、lib/anime1.ts
  - apps/web：SettingsPage、use-watch-session、plugins store、default-plugins
  - plugin-validate.ts、plugin-capabilities.ts、server-capabilities.ts（新）
  - .env.example、docs/TODO.md、docs/CONTEXT.md
- 备注：typecheck 通过

## [2026-07-28] 插件 search/chapters/resolve 结果缓存

- 状态：已完成
- 优先级：P1
- 描述：TODO 3 — 服务端 TTL（search 4h / chapters 12h / resolve 按 URL 分类）；single-flight；客户端 search memory+session、roads-cache 补 TTL；播放失败与鉴权过期 refresh 重解析；smoke 强制 refresh。
- 涉及文件：
  - apps/server/src/lib/ttl-cache.ts
  - apps/server/src/routes/plugin.ts
  - apps/web/src/lib/plugin-api.ts
  - apps/web/src/lib/plugin-result-cache.ts（新）
  - apps/web/src/lib/roads-cache.ts
  - apps/web/src/lib/use-watch-session.ts
  - apps/web/src/lib/plugin-smoke.ts
  - docs/TODO.md、docs/CONTEXT.md
- 备注：typecheck 通过

## [2026-07-28] Bangumi 公开列表双层缓存

- 状态：已完成
- 优先级：P1
- 描述：任务 1 — 首页/番剧/时间表列表缓存。服务端进程内 TTL Map（calendar 24h / trending 12h / browse 2h）；客户端 RQ staleTime（12h / 2h / 30m）。`?refresh=1` 或 Cache-Control: no-cache 绕过。封面直连 lain.bgm.tv，CDN 已有长 max-age，不做图片代理。
- 涉及文件：
  - apps/server/src/lib/ttl-cache.ts（新）
  - apps/server/src/routes/bangumi.ts
  - apps/web/src/pages/HomePage.tsx
  - apps/web/src/pages/TimelinePage.tsx
  - apps/web/src/pages/AnimePage.tsx
  - docs/TODO.md、docs/CONTEXT.md
- 备注：typecheck 通过；未做 UI 刷新按钮（可后续）

## [2026-07-27] 重设计 README

- 状态：已完成
- 优先级：P2
- 描述：结构重写 `README.md`：居中标题/徽章/简介、「这是什么」、支持环境、功能 checklist、快速开始、使用流程、生产/Docker、环境变量、贡献、折叠 Q&A、免责/隐私、致谢。保留自托管必需的 dev/prod 与 `PUBLIC_PROXY` 说明；开发者细节仍指向 `docs/CONTEXT.md`。API 全表从 README 挪走（避免喧宾夺主）。
- 涉及文件：README.md
- 备注：logo 暂用 `apps/web/public/android-chrome-512x512.png`；仓库根无 LICENSE，免责声明未写 GPL

## [2026-07-26] 倍速记忆 + 桌面音量静音图标

- 状态：已完成
- 优先级：P0
- 描述：
  1. 选 1.25x 设置已存，新视频仍 1x：load/src/MSE 重置 playbackRate；ratechange 曾把 1 写回设置。现设 defaultPlaybackRate + 媒体 ready 再 apply；不再用 ratechange 写设置；设置页档位对齐 PLAYER_SPEEDS
  2. 桌面控制条音量旁加扬声器图标：点静音 / 再点恢复上次音量
- 涉及文件：
  - apps/web/src/player/VideoPlayer.tsx
  - apps/web/src/player/chrome/DesktopControls.tsx
  - apps/web/src/player/chrome/types.ts
  - apps/web/src/player/plyr-overrides.css
  - apps/web/src/pages/SettingsPage.tsx
- 备注：typecheck 通过

## [2026-07-26] iOS 首页「继续观看」卡片超宽

- 状态：已完成
- 优先级：P1
- 描述：iOS Safari 首页继续观看卡片宽于热门趋势等模块。Grid 子项 min-width:auto + 横向 flex 副标题未 truncate 撑破轨道。
- 涉及文件：apps/web/src/pages/HomePage.tsx、apps/web/src/components/Layout.tsx
- 备注：grid/item min-w-0 + max-w-full overflow-hidden；封面 shrink-0；副标题 truncate；main min-w-0

## [2026-07-26] 移动端双击暂停 + stall UI 策略

- 状态：已完成
- 优先级：P0
- 描述：
  1. 双击无法暂停：click 计时双击与 dblclick 各调一次 togglePlay → PLAY_TOGGLE_DEDUP_MS 去重
  2. stall 策略（用户规则）：能继续播 → 完全无提示；只有无可播数据（underrun / seek hole / 首载）→ 屏幕中间转圈，无「缓冲中…」等文案
- 涉及文件：
  - apps/web/src/player/chrome/useShellPointerHandlers.ts
  - apps/web/src/player/VideoPlayer.tsx
  - apps/web/src/player/plyr-overrides.css
- 备注：waiting 有 buffer 静默；isUnplayable 才 arm 转圈；HLS non-fatal 不亮 UI

## [2026-07-26] 产品改名 aniku → animaku

- 状态：已完成
- 优先级：P1
- 描述：全仓产品名/包名从 Aniku/`aniku`/`@aniku/*` 改为 Animaku/`animaku`/`@animaku/*`。含 package.json、import、Docker、UA、localStorage key（`animaku-*`，迁移兼容 `aniku-*` 与 `kazumi-web-*`）、`X-Animaku-Proxy-Token`（仍接受旧 `X-Aniku-Proxy-Token`）。
- 涉及文件：package.json、apps/*、packages/shared、scripts、docker-compose、Dockerfile、README、docs/CONTEXT.md、pnpm-lock.yaml 等

## [2026-07-26] 桌面密集弹幕卡顿优化

- 状态：已完成
- 优先级：P0
- 描述：桌面弹幕一多卡顿、移动端流畅。根因：大画布 + 大字号 + 每帧 80×(strokeText+fillText)。优化 CanvasDanmaku：
  1. 字形 atlas：stroke/fill 只做一次，热路径 drawImage
  2. measureText 懒测（spawn 时），reload 不再全量测量
  3. running 原地 prune，去掉每帧 filter 分配
  4. 桌面同屏 soft cap（lane×3，≤64）+ 大舞台 DPR soft-clamp
  5. getContext({ desynchronized: true })
- 涉及文件：apps/web/src/player/media/canvas-danmaku.ts
- 备注：typecheck 通过；移动端路径保持原有上限与字号曲线

## [2026-07-26] 去广告混合代理（playlist-only）

- 状态：已完成
- 优先级：P1
- 描述：
  1. adFilter 且无 cookie/fullProxy 时，m3u8 rewrite 只代理嵌套 .m3u8；.ts 保持 CDN 绝对地址
  2. forceMediaProxy / 直连失败降级 → fullProxy=1，恢复全量代理
  3. KEY/MAP URI= 仍代理；简介条区分「列表代理·分片直连」/「经服务器代理」/「直连源站」
- 涉及文件：media.ts、playback-src.ts、use-watch-session.ts、WatchPage.tsx、SettingsPage.tsx、docs/CONTEXT.md
- 备注：MXdm 默认 adBlocker 开 → 入口仍是 proxy（滤列表），但文案不再误报「全量代理」

## [2026-07-26] 移动端播放器与下方模块同宽 + 日志精简

- 状态：已完成
- 优先级：P1
- 描述：
  1. 移动端播放器不再按 max-h 反推变窄居中；与弹幕/简介/视频源同宽，固定 16:9（宽驱动，无 max-height）
  2. 控制条仍按 @container 播放器宽度压缩
  3. 去掉例行 console.info：`[player] load` / `manifest ok` / `[anime4k] started`
- 涉及文件：apps/web/src/player/plyr-overrides.css、VideoPlayer.tsx、anime4k.ts
- 备注：真错误路径 console.warn 保留

## [2026-07-26] 桌面同步视频源/选集设计

- 状态：已完成
- 优先级：P2
- 描述：桌面 rail 与移动端共用：
  1. 视频源折叠头 = 弹幕/简介条（text-xs · 展开/收起）
  2. 选集 = MobileEpsSection（线路 tab + 横向卡 / 全N话网格）
  移除桌面旧折叠 chevron + 数字网格 + epsOpen
- 涉及文件：WatchPage.tsx、MobileEpsSection.tsx、plyr-overrides.css
- 备注：typecheck 通过；桌面 body 仍有 max-height 独立滚动

## [2026-07-26] 移动端 B 站式选集

- 状态：已完成
- 优先级：P2
- 描述：MobileEpsSection — 「选集 / 全N话」标题行、文字线路 tab、横向集数卡
- 涉及文件：MobileEpsSection.tsx、WatchPage.tsx、plyr-overrides.css

## [2026-07-26] 移动端观看页重制 + 横屏比例

- 状态：已完成
- 优先级：P1
- 描述：
  1. 横屏：短轴高度反推宽度，16:9 自适应（不再竖屏比例卡死）
  2. 竖屏：播放器 sticky 顶栏下；栈序 player → meta → 视频源 → 选集
  3. meta 默认对齐弹幕条；展开后紧凑封面/标签/简介/收藏
  4. 横屏不 sticky；桌面 DesktopWatchLayout 不动
- 涉及文件：
  - apps/web/src/player/plyr-overrides.css
  - apps/web/src/pages/watch/MobileWatchLayout.tsx
  - apps/web/src/pages/watch/WatchMeta.tsx
  - apps/web/src/pages/WatchPage.tsx
- 备注：focus scroll 改为 block:nearest；--kz-header-offset 3.5rem

## [2026-07-26] 移动/桌面弹幕字号分轨 + 全屏压小

- 状态：已完成
- 优先级：P1
- 描述：弹幕原先只按容器宽度缩放，手机全屏宽≈桌面中档 → 字号过大遮画面。现按 pointerMode + fullscreen 分轨：
  - desktop：仍 width/720，[0.48, 1.1]
  - mobile 窗内：按 stage 高度 ~4.2%，约 12–18px
  - mobile 全屏：按高度 ~3.2%，约 11–14.5px（横屏 844×390 从 ~28px → ~12px）
  - 移动全屏同屏上限 48、行距略紧、速度略慢
- 涉及文件：
  - apps/web/src/player/media/danmaku-utils.ts
  - apps/web/src/player/media/canvas-danmaku.ts
  - apps/web/src/player/VideoPlayer.tsx
- 备注：typecheck 通过；布局经 ref 避免 src effect 闭包过期

## [2026-07-26] P0 完整弹幕：Canvas + 媒体时间 + 恒速

- 状态：已完成
- 优先级：P0
- 描述：替换 @ironkinoko/danmaku DOM/CSS transition 为自研 Canvas 引擎
  - 每帧 x = f(video.currentTime)，卡顿与画面同相
  - duration = (stageW + textW) / speed，长短句视觉匀速
  - strokeText 轻描边；同屏上限 80；暂停停 rAF
  - 移除 ironkinoko 依赖
- 涉及文件：
  - apps/web/src/player/media/canvas-danmaku.ts（新）
  - apps/web/src/player/media/danmaku-utils.ts
  - apps/web/src/player/VideoPlayer.tsx
  - apps/web/src/player/plyr-overrides.css
  - apps/web/package.json / vite.config.ts
- 备注：typecheck 通过

## [2026-07-26] 选集面板视觉 + 选源后聚焦 UX

- 状态：已完成
- 优先级：P2
- 描述：
  1. 选集：线路（紫描边 chip）与集数（蓝实心）分色；移动端更密更小
  2. 有分集后自动折叠视频源；手动点选结果同样折叠
  3. 移动端点选后 scrollIntoView 到 #kz-watch-focus（选集+播放器）
- 涉及文件：
  - apps/web/src/pages/WatchPage.tsx
  - apps/web/src/pages/watch/MobileWatchLayout.tsx
  - apps/web/src/player/plyr-overrides.css
- 备注：无自动命中时视频源保持展开

## [2026-07-26] 视频源搜索结果引导

- 状态：已完成
- 优先级：P2
- 描述：点规则源后用户不知还需点搜索条目；强化「点选条目」引导与结果可点击感
- 涉及文件：apps/web/src/pages/WatchPage.tsx
- 备注：needsPick 态高亮卡片 + 列表「选用」标签 + 选集空态两步文案

## [2026-07-26] 桌面 rail 分板 + Anime1 搜索过滤

- 状态：已完成
- 优先级：P1–P2
- 描述：
  1. 桌面观看页右侧「视频源 / 选集」不再共用外层滚动，各自独立限高
  2. Anime1 搜索过滤「動畫列表 / 季度新番」等导航页
- 涉及文件：
  - apps/web/src/player/plyr-overrides.css
  - apps/web/src/pages/WatchPage.tsx
  - apps/web/src/pages/watch/DesktopWatchLayout.tsx
  - apps/server/src/lib/anime1.ts
- 备注：见 `.claude/BUGS.md`

## [2026-07-26] 性能审计 P0/P1 落地

- 状态：已完成（待 push）
- 优先级：P0–P1
- 描述：续播正确性、播放热路径、Anime4K 超分可见差异、媒体/上游超时与 AbortSignal
- 涉及文件：见下方 commits
- 备注：CLAUDE.md 为用户协作规则改动，未纳入产品 commit

### P0 完成
- 续播 resumePosition state + sourceUrl + resumeDone 成功后标记
- auto-pick 相似度阈值 0.55
- timeupdate 节流、弹幕条件 reload、settings debounce
- Anime4K 2× target / 更高 maxDimension / canvas contain
- plugins defaultsVersion merge 保留

### P1 完成
- media m3u8 限长 + cancel body
- bangumi/dandan/bilibili 超时
- 规则搜索仅首词 retry
- 客户端 AbortSignal 贯穿 api/RQ/弹幕 match

### 待处理（P2+）
- 反代 / Docker 开放代理门禁
- cookie 不下 query / 会话化
- soft-fail 契约统一
- DNS-safe fetchPublic
