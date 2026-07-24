# 项目上下文（开发者）

面向后续维护者与协作者的**设计背景、架构约定与踩坑记录**。  
日常上手见根目录 [README.md](../README.md)；给 AI 助手的精简约定见 [CLAUDE.md](../CLAUDE.md)。

产品名：**Aniku**（包：`aniku` / `@aniku/*`）。

---

## 1. 这是什么

**Aniku** = 浏览器里的番剧应用：

- 浏览 / 搜索 / 时间表（Bangumi）
- 用户导入的 **兼容规则**（KazumiRules JSON）选源、解析、播放
- 弹弹 play 弹幕 + 本地历史 / 追番

它是 **React SPA + 本地 Hono API**，不是桌面客户端官方 Web 移植。

| 仓库 | 角色 |
|------|------|
| 本仓库 `aniku` | 完整读写 |
| 工作区旁 `Kazumi/`（若存在） | 只读参考 |
| 工作区旁 `agefans-enhance/`（若存在） | 只读参考 |

参考项目的模式可以抄，**不要整文件搬**。

---

## 2. 功能从哪两个项目来

| 参考 | 形态 | 本仓库主要借鉴 |
|------|------|----------------|
| [Kazumi](https://github.com/Predidit/Kazumi) | Flutter 客户端 | Bangumi；[KazumiRules](https://github.com/Predidit/KazumiRules)；XPath/API 规则；关键词策略与选源；弹弹匹配；历史；跳 OP/ED |
| [agefans-enhance](https://github.com/IronKinoko/agefans-enhance) | 油猴 | [@ironkinoko/danmaku](https://github.com/IronKinoko/danmaku)；弹弹鉴权思路；播放器内弹幕面板；XML 拖入；偏移与快捷键 |

**相对桌面 Kazumi 的硬天花板：**

- 没有内嵌 **WebView 媒体拦截**。
- 播放地址优先靠服务端**静态 HTML** 抽 m3u8/mp4。
- 抽不到时可用 **iframe 嵌源站页**（`EmbedPlayer`）降级——**不等于** WebView：跨域拦不到直链、弹幕/续播/跳过不可用，且很多站禁止被嵌（`X-Frame-Options` / CSP）。

大量 `POST /api/plugin/resolve 502` 多半是**解析能力上限**，不是 CDN 文件全坏了。

---

## 3. 技术栈与 monorepo

```
aniku/
  apps/web/          @aniku/web     React 19 + Vite 6 + Tailwind 4 + TanStack Query + Zustand
  apps/server/       @aniku/server  Hono + @hono/node-server
  packages/shared/   @aniku/shared  类型与解析器（源码导出，无独立 build）
  docs/              开发者文档（本文件等）
  .env.example
```

- 包管理：`pnpm@9.15.0`，Node ≥ 20  
- Workspace：`apps/*`、`packages/*`，内部依赖 `workspace:*`  
- Shared：`exports: "./src/index.ts"`，改 `packages/shared/src/*` 即可被两端引用  

常用命令：

```bash
pnpm install
pnpm dev              # web + server (ports from .env WEB_DEV_PORT / PORT)
pnpm typecheck
pnpm --filter @aniku/web typecheck
pnpm --filter @aniku/server typecheck
```

当前**没有**单元/集成测试 runner；校验靠 `tsc` + 手动 `pnpm dev`。

---

## 4. 请求流

```
Browser (WEB_DEV_PORT，默认 5173)
  ├─ Bangumi  ── /api/bangumi/*  ──► api.bgm.tv / next.bgm.tv
  ├─ 弹幕     ── /api/danmaku/*  ──► api.dandanplay.net（及 B 站 BV 代理）
  ├─ 规则     ── /api/plugin/*   ──► rule-engine → 第三方站 HTML / API
  └─ 播放     ── /api/media/proxy?url= ──► 代流 m3u8/mp4（改写 m3u8 URI）
```

- Vite 把 `/api` 代理到 `http://127.0.0.1:$PORT`（可用 `API_PROXY_*` 覆盖）  
- 入口：`apps/server/src/index.ts`  
- **用户数据边界：** Bangumi Token、规则 JSON 只存浏览器；服务端不落库，每次插件调用 POST 完整 `rule`  

---

## 5. 环境变量

见 `.env.example`。API：`apps/server/src/config.ts` 从仓库根 / `apps/server` 加载（自写解析）。Web：`apps/web/vite.config.ts` 用 Vite `loadEnv` 读同一份根 `.env`。**端口均从 env 读，代码里只有默认值。**

| 变量 | 说明 |
|------|------|
| `PORT` / `HOST` | API 监听，默认 `8787` / `0.0.0.0`；Docker 容器内同此 |
| `WEB_DEV_PORT` / `WEB_HOST` | 仅本地 Vite 开发监听（默认 `5173` / 代码默认 host `127.0.0.1`）；生产 Docker / `pnpm start` 不用，浏览器走 `PORT` |
| `WEB_HMR_HOST` | 可选；`WEB_HOST=0.0.0.0` 时 HMR 用的主机，默认 `127.0.0.1` |
| `API_PROXY_HOST` / `API_PROXY_TARGET` | 可选；Vite `/api` 代理目标，默认 `http://127.0.0.1:$PORT` |
| `DANDAN_APP_ID` / `DANDAN_APP_SECRET` | 可选；空则用内置 legacy 密钥 + `X-AppId`/`X-AppSecret` |
| `BANGUMI_USER_AGENT` | 请求 Bangumi 的 UA，默认 `aniku/0.1` |
| `PRODUCT_USER_AGENT` | 产品身份 UA（弹弹等），默认 `aniku/0.1` |
| `DEFAULT_USER_AGENT` | 抓插件 HTML / 媒体等浏览器型 UA |
| `CORS_ORIGINS` | 额外浏览器 Origin（逗号分隔）；默认仅 localhost/127.0.0.1。`*` 开放 CORS（不推荐） |
| `PUBLIC_PROXY` | 默认关：媒体代理 + 规则 search/chapters/resolve 仅本机/局域网。公网部署设 `1` |
| `PROXY_TOKEN` | 可选；请求头 `X-Aniku-Proxy-Token` 或 query `proxyToken` 可绕过局域网限制 |

**不要**再引入已死的公共 DPlayer 弹幕池 / `DPLAYER_API`。

---

## 6. 规则引擎（关键路径）

1. **默认 / 导入 / 商店** — `DEFAULT_PLUGIN_RULES`（`Anime1`、`otage`、`xifan`、`MXdm`）；设置页导入或 `GET /api/plugin/catalog`。规则旁「测试」= 内置关键词自动 **search→chapters→resolve** 冒烟（`apps/web/src/lib/plugin-smoke.ts`），无需用户输入  
2. **搜索** — `POST /api/plugin/search` → `searchWithRule`  
   - XPath：cheerio → xml → xmldom + xpath，失败有 cheerio 卡片回退  
   - API：`searchMode: 'api'` + `searchApiConfig`（如 **sorani**、**TvTFun**）→ `rule-engine/api.ts`  
3. **分集** — `POST /api/plugin/chapters` → `chaptersWithRule`（XPath 或 `chapterApiConfig`）  
4. **解析** — `POST /api/plugin/resolve` → 静态抽 m3u8/mp4（`player_aaaa`、iframe 浅跟、正则等）  
5. **播放** — 浏览器用 `proxyUrl`；失败则 `EmbedPlayer` iframe 源站 `pageUrl`  

分集侧栏缓存：`sessionStorage` 键 `roads:{bangumiId}:{pluginName}`（详情页写入，播放页读取）。

### 搜索约定（对齐 Kazumi，故意不做引擎内模糊）

| 层 | 行为 |
|----|------|
| `buildSearchKeywords` | 短标题优先，去括号 / 第 N 期 / S2 |
| `titleSimilarity` / `rankSearchItems` | 排序；**最终仍由用户点选** |
| `expandKeywordCandidates` | 单关键词最多 4 个短变体再试 |
| 详情页 | 多插件并发 + 别名 / 手动检索 |

### 软失败（请保持）

- 搜索解析完成但 0 条 → **HTTP 200** + `diagnostics`，不要整页 502  
- resolve 优先 **m3u8**，签名 mp4（如 qq photo `dis_k`）易过期  
- 媒体代理禁内网主机；403 可松 referer 重试  

### HLS 广告过滤（对齐 Kazumi）

- **不是**浏览器广告拦截 / 域名黑名单，只处理 playlist 里 `#EXT-X-DISCONTINUITY` 分隔的短 TS 段（启发：&lt;正片 30%、首末 &lt;30s、任意 &lt;10s）。
- 算法：`packages/shared/src/m3u8-ad-filter.ts`；代理 `GET /api/media/proxy?…&adFilter=1` 在 rewrite 前过滤 media 列表。
- **嵌套 m3u8：** 顶层常是 master（无 DISCONTINUITY）；rewrite 子列表 URI 时必须**继续带上** `adFilter=1`，否则只滤 master（空操作）而 `mixed.m3u8` 广告仍在（MXdm 即此结构）。
- 开关：规则 JSON `adBlocker`（设置页「广告过滤」）；全局 `player.forceAdBlocker`（强制，忽略规则关）。默认内置仅 **MXdm** 开，Anime1 / otage / xifan 关。
- 开启时 m3u8 **强制走代理**（直连 CDN 会跳过过滤）。无 DISCONTINUITY 的片源无效；iframe 降级无效。
- **媒体走服务器代理** `player.forceMediaProxy`（设置页）：默认关，优先浏览器直连 CDN；勾选后一律用 `/api/media/proxy`（弱网/跨网/源站限浏览器时）。搜索/分集/解析本就走 API，此项只影响播放媒体。直连失败时页面仍会临时 `forceProxy` 一次。

### 校验 API 规则时

`searchMode === 'api'` **不要**强制 `searchURL`；应要求 `searchApiConfig`。  
XPath 规则仍要求 `name` + `baseURL` + `searchURL`。

---

## 7. 播放器与弹幕

### 职责拆分（不要再揉回去）

```
原生 <video>     → UI：控制栏（播/进退/音量/倍速/超分/全屏）；解码 + 音频
hls.js           → HLS 挂到同一 <video>
Anime4K (可选)   → WebGPU canvas 覆盖层（默认关，不占 GPU）
@ironkinoko/danmaku → 视频上的透明层（pointer-events:none）
弹弹 / B 站 BV   → /api/danmaku/*
```

**不要**再为播放壳引入 **Plyr** 或 **DPlayer**（都试过、都弃用）：

| 方案 | 失败形态 |
|------|----------|
| DPlayer 公共弹幕池 | 服务已死；禁止配 `danmaku` / `apiBackend` |
| Plyr + hls.js | 有声黑屏；MSE blob 被 remount / blankVideo 撕掉 |
| 外层 `overflow-hidden` + `rounded-*` 包硬件解码 video | **Chrome：有声画面黑**（详情页壳尤其容易） |

### 正确媒体管线

1. 稳定 React 宿主：固定 `<video ref>`，不要让 UI 库挪走 media 节点  
2. m3u8 → `Hls.loadSource` + `attachMedia`；否则 `video.src`  
3. 清单/metadata 后再续播 `seek` + `play()`  
4. 弹幕：`BASE_DANMAKU_SPEED = 130` × 用户倍速；评论/设置变化用 `reload`  
5. 换源：destroy hls → destroy 弹幕 → stop Anime4K → 再 attach；用 generation 丢弃过期回调  

### 超分（Anime4K / WebGPU）

- 语义对齐桌面 Kazumi：关 / **效率档** / **质量档**；`player.superResolution`（默认 `off`）
- 实现：`apps/web/src/player/anime4k.ts` + `anime4k-webgpu`；**动态 import**，未开启时不加载库、不申请 GPU
- 画面：`<video>` 继续解码；开启后 `opacity:0`，画面画在 `<canvas class="kz-sr-canvas">`；弹幕仍在最上层
- 效率：Clamp + CNNM + CNNx2M；质量：`ModeA` 预设
- 官方 `render()` 无 stop → 自建 rVFC + `device.destroy()`；换集 / 关档 / unmount 必须 stop
- 需要 **WebGPU**（Chrome/Edge 等）且页面为 **安全上下文**（HTTPS 或 `localhost` / `127.0.0.1`）。Docker 用 `http://局域网IP:PORT` 打开时 `navigator.gpu` 不存在，超分不可用（菜单仍可打开并提示原因）。**iframe 降级不做超分**。iOS **系统视频全屏**看不到 canvas，用「网页全屏」
- 控制条「超分」菜单始终可点；无 WebGPU 时仅禁用效率/质量项。设置页下拉共用同一字段

### 布局雷区

- 播放页结构：`VideoPlayer` 自带 `aspect-video`；**不要**用 `embedded` 填满再被圆角裁切父级包住  
- 避免 `isolation: isolate` 盖在 video 上；注意 ironkinoko stage 的 `translateZ(0)` 可能黑屏  
- 全屏遮罩层全屏区域 `pointer-events: none`，只有真正控件可点  

### 开发 remount

`apps/web/src/main.tsx` **开发环境不用 React StrictMode**：双挂载会拆掉 HLS MSE，表现为播不了。生产单挂载没问题。

### 弹幕

- 面板：`DanmakuPanel`（搜索 / 设置 / 导入）  
- `PlayPage` **和** `SubjectPage` 都要传 `danmakuPanel`，否则控制栏没有「幕」  
- 导入：XML（`parseDanmakuXml`）、BV（`GET /api/danmaku/bilibili`）  
- 自动匹配：bgm 映射与标题搜索并行；**不要**在新评论加载成功前清空旧评论；**不要**阻塞视频 resolve  
- 凭证：`.env` 空时走 agefans 兼容 fallback；`/api/danmaku/status` 在有 fallback 时 `configured: true`  

### 快捷键（焦点在播放器；输入框内忽略）

| 键 | 作用 |
|----|------|
| Space / K | 播放暂停 |
| ← / → | ±5s |
| ↑ / ↓ | 音量 |
| F | 播放器全屏 |
| D | 弹幕开关 |
| `,` / `.` / `/` | 弹幕滞后 / 超前 / 复位 |
| Alt+M | 弹幕面板 |
| P / N | 上 / 下集 |

全屏控制栏两个直达按钮：**全屏**（`shell.requestFullscreen`，F 键）/ **网页全屏**（CSS `kz-web-fs`）。已去掉「浏览器全屏」与二级菜单。默认尺寸 `.kz-player-frame`：16:9 且 `max-height ≈ 100dvh - 11rem`，小屏笔记本不撑破视口。

---

## 8. 前端结构速查

| 区域 | 位置 |
|------|------|
| 路由 | `apps/web/src/App.tsx` |
| 页面 | `apps/web/src/pages/*` |
| 顶栏搜索 | `components/Layout.tsx` → `/search?q=` |
| API | `lib/api.ts`、`lib/bangumi.ts`、`lib/plugin-api.ts` |
| 状态 | `stores/settings.ts`、`plugins.ts`、`history.ts`（localStorage） |
| 播放 | `player/VideoPlayer.tsx`、`DanmakuPanel.tsx`、`EmbedPlayer.tsx` |

---

## 9. 关键文件表

| 关注点 | 文件 |
|--------|------|
| 关键词 / 排序 / 规则类型 / parsePluginRule | `packages/shared/src/plugin.ts` |
| 弹幕类型 / XML / BV 提取 | `packages/shared/src/danmaku.ts` |
| 播放偏好 | `packages/shared/src/player.ts` |
| 规则引擎 | `apps/server/src/rule-engine/index.ts` + `api.ts` |
| 插件 HTTP | `apps/server/src/routes/plugin.ts` |
| 规则商店 | `apps/server/src/routes/plugin-catalog.ts` |
| 媒体代理 | `apps/server/src/routes/media.ts` |
| 弹弹 | `routes/danmaku.ts` + `lib/dandan.ts` |
| B 站弹幕 | `routes/bilibili-danmaku.ts` |
| 配置 / UA | `apps/server/src/config.ts` |
| 详情选源 | `apps/web/src/pages/SubjectPage.tsx` |
| 播放页 | `apps/web/src/pages/PlayPage.tsx` |
| 默认规则 | `apps/web/src/data/default-plugins/` |
| 入口（无 StrictMode） | `apps/web/src/main.tsx` |

---

## 10. 踩坑清单（请保留）

1. **详情页黑屏、播放页正常** → 查外层 `overflow-hidden rounded-*`，不是流挂了。  
2. **有声无画** → 合成层（overflow / radius / isolation / danmaku stage），不是 m3u8 404。  
3. **代理 `.ts` 一直 200 仍黑** → 管线 OK，修 UI 叠层。  
4. **弹幕未配置** 且 `.env` 空 → 确认 `dandan.ts` fallback 与 status。  
5. **SubjectPage 无「幕」** → 是否漏传 `danmakuPanel`。  
6. **安装 sorani 502「缺少 searchURL」** → 旧校验强制 XPath；API 规则必须走 `searchApiConfig`。  
7. **TS `baseUrl` deprecated** → web 的 `tsconfig` 不要无意义 `baseUrl`/`paths`；别名只放 Vite。  
8. **不要轻易加回 Plyr**，除非完整隔离 MSE + remount。  

---

## 11. 约定

- 面向用户的文案用**中文**  
- 规则字段对齐 Kazumi JSON；默认规则保持精简，更多源走导入 / 商店  
- 位置 XPath `//div[n]` 很脆 → 优先改回退 / 关键词，而不是引擎里造模糊 XPath  
- 根目录脚本用 `pnpm -r` / `--filter`  

---

## 12. 文档索引

| 文件 | 读者 |
|------|------|
| [README.md](../README.md) | 用户与快速开始 |
| [docs/CONTEXT.md](./CONTEXT.md) | **开发者上下文（本文）** |
| [CLAUDE.md](../CLAUDE.md) | Claude / 自动化助手工作约定（英文为主，与本文同步关键决策） |
| `.env.example` | 环境变量模板 |

更新架构或踩坑时：**同时改本文与 `CLAUDE.md` 相关段落**，避免两套说法。
