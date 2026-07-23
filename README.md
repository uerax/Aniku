# Aniku

浏览器里的番剧应用：**Bangumi 元数据** · **规则选源播放** · **弹弹弹幕** · **本地历史 / 追番**。

## 快速开始（本地开发）

### 1. 环境

| 工具 | 版本 |
|------|------|
| Node.js | ≥ 20（建议 LTS） |
| pnpm | **9.15.0**（与 `packageManager` 字段一致） |

```bash
# 安装 pnpm（任选）
npm install -g pnpm@9.15.0
# 或：corepack enable && corepack prepare pnpm@9.15.0 --activate

node -v && pnpm -v
```

请在 **仓库根目录** 使用 pnpm，不要用 npm/yarn 直接装依赖。

### 2. 安装与配置

```bash
git clone <remote> aniku
cd aniku

pnpm install
cp .env.example .env   # 按需修改
```

### 3. 启动

```bash
pnpm dev
```

| 进程 | 默认地址 | 说明 |
|------|----------|------|
| Web（Vite） | http://localhost:5173（`WEB_DEV_PORT`） | **浏览器只开这个** |
| API（Hono） | http://localhost:8787（`PORT`） | Vite 把 `/api` 代理过来 |

```bash
pnpm dev:web       # 仅前端
pnpm dev:server    # 仅后端
pnpm typecheck     # 全仓 tsc
```

跳过 `pnpm install` 直接 `pnpm dev` 会报找不到 `tsx` / `node_modules missing`。

---

## 环境变量

完整注释见 [.env.example](.env.example)。服务端从仓库根与 `apps/server` 加载；Vite 读仓库根同一份。

### 常用

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` / `HOST` | `8787` / `0.0.0.0` | API / 生产单进程监听 |
| `WEB_DEV_PORT` / `WEB_HOST` | `5173` / 代码默认 `127.0.0.1` | **仅本地 Vite**；Docker 生产不用 |
| `WEB_HMR_HOST` | — | `WEB_HOST=0.0.0.0` 时 HMR 主机，默认 `127.0.0.1` |
| `API_PROXY_*` | — | 可选；Vite `/api` 代理目标 |
| `DANDAN_APP_ID` / `DANDAN_APP_SECRET` | 空 | 空则用内置 legacy 客户端密钥，开箱可弹幕 |
| `BANGUMI_USER_AGENT` / `PRODUCT_USER_AGENT` | `aniku/0.1` | 上游 UA |
| `DEFAULT_USER_AGENT` | 浏览器型 UA | 抓插件 HTML / 媒体 |

### 公网部署（重要）

| 变量 | 说明 |
|------|------|
| `PUBLIC_PROXY` | 默认关：媒体代理 + 规则 search/chapters/resolve **仅本机/局域网**。VPS 给浏览器公网访问时设 `1` |
| `PROXY_TOKEN` | 可选；请求头 `X-Aniku-Proxy-Token` 或 `?proxyToken=` 可绕过局域网限制 |
| `CORS_ORIGINS` | 额外允许的浏览器 Origin（逗号分隔）；localhost 始终可用。`*` 开放 CORS（不推荐） |

**本机 / 局域网开发：不必开 `PUBLIC_PROXY`。**  
**VPS 公网：通常需要 `PUBLIC_PROXY=1`，否则选源/播放代理会 403。** 打开后他人也可借你的服务器出口拉流，请知悉带宽风险（仍有内网 SSRF 拦截）。

---

## 生产运行（本机 Node）

形态：**一个进程** 同时提供 `/api/*` 与 SPA（同源，无需 Vite 代理）。

```bash
pnpm start:prod
# 等价：pnpm build && pnpm start
#   build:web   → apps/web/dist
#   build:server → apps/server/dist/index.js（esbuild 单文件）
#   start       → node dist/index.js（无 tsx）
```

浏览器打开：**http://localhost:$PORT**（默认 `8787`）。

| 变量 | 说明 |
|------|------|
| `PORT` / `HOST` | 监听 |
| `WEB_DIST` | 静态目录（相对 **进程 cwd**）。Docker 内为 `public`；本机可省略，会探测 `public` / `apps/web/dist` 等 |

可选：前面再挂 Nginx/Caddy 做 HTTPS，反代到 `$PORT` 即可。

开发请继续用 `pnpm dev`（tsx watch），不要用生产 `start` 做日常改代码。

---

## Docker / Compose

单镜像：构建前端 + 服务端 bundle，运行时只有 `node dist/index.js` + SPA。

```bash
cp .env.example .env    # 按需改 PORT、PUBLIC_PROXY 等
docker compose up -d --build

docker compose logs -f
docker compose down
```

| 变量 | 默认 | 作用 |
|------|------|------|
| `PORT` | `8787` | 主机与容器监听；浏览器入口 **http://localhost:$PORT** |
| `WEB_DEV_PORT` | `5173` | 仅本地 Vite；Compose 生产不用 |

```bash
# 不用 compose
docker build -t aniku .
docker run --rm -p 8787:8787 --env-file .env -e PORT=8787 -e PUBLIC_PROXY=1 aniku
```

- 健康检查：`GET /api/health`
- 镜像内 `WEB_DIST=public`

---

## 使用流程

1. 开发：打开 http://localhost:$WEB_DEV_PORT · 生产/Docker：http://localhost:$PORT  
2. **设置 → Bangumi Token**（可选，用于追番）  
3. 规则：默认已内置（如 `7sefun` / `MXdm`）；可导入 JSON 或从 **规则仓库** 安装  
4. 详情页 → 选源 → 选集播放（能直链则浏览器直连 CDN，失败自动回退媒体代理）  
5. 播放页自动匹配弹幕；控制栏「幕」打开面板  

### 播放快捷键

| 键 | 作用 |
|----|------|
| Space / K | 播放 / 暂停 |
| ← / → | ±5s |
| ↑ / ↓ | 音量 |
| F | 播放器全屏 |
| D | 弹幕开关 |
| `,` / `.` / `/` | 弹幕滞后 / 超前 / 偏移复位 |
| Alt+M | 弹幕面板 |
| P / N | 上 / 下一集 |
| 拖入 `.xml` | 导入 B 站 / pakku 弹幕 |

控制栏另有 **网页全屏**（CSS 铺满，不走 Fullscreen API）。  
设置页：默认倍速、自动下一集、续播、跳 OP/ED、超分档位等。

---

## API 一览

| 路径 | 说明 |
|------|------|
| `GET /api/health` | 健康检查 |
| `GET /api/bangumi/calendar` | 放送表 |
| `GET /api/bangumi/trending` | 趋势 |
| `POST /api/bangumi/search` | 搜索 |
| `GET /api/bangumi/subjects/:id` | 详情 |
| `GET /api/bangumi/subjects/:id/episodes` | 分集 |
| `GET /api/bangumi/me` | 当前用户（需 Token） |
| `GET/PUT /api/bangumi/collections…` | 收藏 |
| `GET /api/danmaku/*` | 弹弹代理（status / search / bangumi / comment 等） |
| `GET /api/danmaku/bilibili` | B 站 BV 弹幕 |
| `POST /api/plugin/search\|chapters\|resolve` | 规则执行（可受 `PUBLIC_PROXY` 限制） |
| `GET /api/plugin/catalog` | 规则商店目录（`?mirror=1` 镜像） |
| `GET /api/plugin/catalog/:name` | 下载单条规则 |
| `GET /api/media/proxy` | 媒体流代理（可受 `PUBLIC_PROXY` 限制） |

用户 Token 与规则 JSON **只存在浏览器**；插件请求每次 POST 完整 `rule`，服务端不落库。

---

## 常见问题

| 现象 | 处理 |
|------|------|
| `pnpm: command not found` | 安装 pnpm 9.15.0，检查 `PATH` |
| `node_modules missing` / `spawn ENOENT`（tsx） | 在仓库**根**执行 `pnpm install` |
| 页面 `/api/*` 全失败 | 确认 `pnpm dev` 起了 server；不要只开 `dev:web` |
| Docker 首页 404 | 确认镜像构建含 SPA；`WEB_DIST=public` 与健康检查正常 |
| 公网能开页但不能播 / 选源 403 | 设置 `PUBLIC_PROXY=1`（或配置 `PROXY_TOKEN`） |
| 弹幕「未配置」 | 本地可留空 `DANDAN_*`；查 `/api/danmaku/status` 与服务端日志 |
| 有声无画 | 多为布局/合成（`overflow`+圆角等），见 [docs/CONTEXT.md](docs/CONTEXT.md) |
| 大量源解析失败 | Web 静态解析上限；换规则/线路，或接受 iframe 降级 |

---

## 说明与免责

- 默认仅内置少量示例规则；更多请从 [KazumiRules](https://github.com/Predidit/KazumiRules) 安装或自行导入。  
- 元数据：[Bangumi](https://bangumi.tv/) · 弹幕：[弹弹play](https://www.dandanplay.com/)。  
- 请遵守所在地法律法规；因使用产生的缓存建议及时清理。  
- 部分站点有反爬 / 验证码 / 防盗链，Web 端可能解析失败，可换规则或线路。  

实现上曾参考 [Kazumi](https://github.com/Predidit/Kazumi) 与 [agefans-enhance](https://github.com/IronKinoko/agefans-enhance)。
