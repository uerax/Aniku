# Aniku

浏览器端的番剧浏览 / 选源播放 / 弹幕 / Bangumi 追番应用。

> **仅 Web**：本仓库是 React 网页 + 本地 API 代理，不是 Flutter / 桌面安装包。  
> 包名：`aniku` / `@aniku/*` · 远程仓库若仍为旧名，以实际 GitHub 地址为准。

**开发者：** 架构约定、规则引擎、播放器/弹幕设计与踩坑见 [docs/CONTEXT.md](docs/CONTEXT.md)。  
给 AI 助手的工作约定见 [CLAUDE.md](CLAUDE.md)。

## 能力与规则生态

| 模块 | 说明 |
|------|------|
| 首页 / 时间表 / 搜索 | Bangumi 元数据 |
| 详情 | 简介、分集、收藏状态、选源 |
| 规则插件 | 内置默认规则 + 本地导入 + 兼容 [KazumiRules](https://github.com/Predidit/KazumiRules) 仓库安装 |
| 播放 | 原生 video + [hls.js](https://github.com/video-dev/hls.js)（HLS/MP4、倍速、热键、全屏）+ 自动下一集 / 续播 / 跳过片头片尾 |
| 弹幕 | 弹弹play 自动匹配 + 播放器内弹幕面板 + [@ironkinoko/danmaku](https://github.com/IronKinoko/danmaku)；XML 拖入 / B 站 BV |
| 追番 | Bangumi Access Token 同步收藏 |
| 历史 | 本地播放进度 |

规则 JSON 字段与社区 [KazumiRules](https://github.com/Predidit/KazumiRules) 兼容；早期实现曾参考 [Kazumi](https://github.com/Predidit/Kazumi) 与 [agefans-enhance](https://github.com/IronKinoko/agefans-enhance)。Web 端无桌面 WebView 媒体拦截，部分源依赖静态解析或 iframe 降级。

## 技术栈

- `apps/web` — React + Vite + TypeScript + Tailwind + TanStack Query + Zustand
- `apps/server` — Hono（Bangumi / 弹弹 / 规则引擎 / 媒体代理）
- `packages/shared` — 共享类型

## 快速开始

### 前置要求

| 工具 | 版本 | 说明 |
|------|------|------|
| **Node.js** | ≥ 20 | 建议 LTS 或当前稳定版 |
| **pnpm** | **9.15.0** | 本仓库 monorepo 的包管理器（见 `packageManager` 字段） |

本项目是 **pnpm workspace**（`apps/*` + `packages/*`，内部依赖 `workspace:*`）。根目录脚本（`pnpm dev`、`pnpm -r` / `--filter`）按 pnpm 编写，**请用 pnpm，不要用 npm / yarn 直接装依赖**，否则容易出现 workspace 解析失败、`node_modules` 布局不对等问题。

#### 安装 pnpm

任选其一（版本对齐 9.15.0）：

```bash
# 方式 A：npm 全局安装（最常见）
npm install -g pnpm@9.15.0

# 方式 B：Corepack（Node 自带；若遇权限错误可改用方式 A）
corepack enable
corepack prepare pnpm@9.15.0 --activate

# 方式 C：不装全局，临时调用
npx pnpm@9.15.0 install
npx pnpm@9.15.0 dev
```

验证：

```bash
node -v    # 应 ≥ v20
pnpm -v    # 期望 9.15.0
```

若新开终端提示 `pnpm: command not found`，把全局 bin 加进 `PATH` 后重开终端，例如：

```bash
export PATH="$(npm prefix -g)/bin:$PATH"
```

### 1. 克隆并进入仓库根目录

```bash
git clone <your-fork-or-remote> aniku
cd aniku   # 必须在 monorepo 根目录执行后续命令
```

### 2. 安装依赖

```bash
pnpm install
```

会为根目录、`apps/web`、`apps/server`、`packages/shared` 装齐依赖（含服务端 dev 用的 `tsx` 等）。  
**跳过这一步直接 `pnpm dev`，会出现 `node_modules missing` / `spawn ENOENT`（找不到 `tsx`）。**

### 3. 环境变量

```bash
cp .env.example .env
```

编辑 `.env`（可选；完整字段见 `.env.example`）：

```env
# Server (API)
PORT=8787
HOST=0.0.0.0

# Website (Vite dev)
WEB_PORT=5173
WEB_HOST=0.0.0.0

# 弹幕开放平台密钥（申请：https://www.dandanplay.com/ ）
# 留空时使用与 agefans-enhance 相同的内置客户端密钥，开箱即可匹配弹幕
DANDAN_APP_ID=
DANDAN_APP_SECRET=
```

不填密钥也能拉弹幕；若日后内置密钥失效，再自行申请并写入即可。  
- **API** 从仓库根与 `apps/server` 读 `.env`（`apps/server/src/config.ts`）  
- **Vite** 同样读仓库根 `.env`（`apps/web/vite.config.ts`），`WEB_PORT` / `PORT` 控制前端监听与 `/api` 代理目标  

### 4. 启动（Web + API）

```bash
# 在仓库根目录
pnpm dev
```

会并行启动（端口以 `.env` 为准，下表为默认）：

| 进程 | 地址 | 说明 |
|------|------|------|
| Web（Vite） | http://localhost:`WEB_PORT`（默认 5173） | 浏览器只开这个即可 |
| API（Hono） | http://localhost:`PORT`（默认 8787） | Vite 将 `/api` 代理到此 |

只启动一端时：

```bash
pnpm dev:web      # 仅前端
pnpm dev:server   # 仅后端
```

类型检查（当前无单元测试 runner，校验靠 tsc + 手动点流程）：

```bash
pnpm typecheck
# 或单个包
pnpm --filter @aniku/web typecheck
pnpm --filter @aniku/server typecheck
```

### 5. 生产构建（本机 Node，单进程）

本项目是 **浏览器 SPA + 本地/服务器 API**，**不是** Flutter/Electron 安装包。生产形态：编译前端静态资源，由 Hono **同一端口** 托管（`/api/*` + SPA）。

```bash
# 1) 构建前端 → apps/web/dist
pnpm build:web

# 2) 启动 API（会自动挂载 web dist / public，找不到则仅 API）
pnpm start
# 或一步：pnpm start:prod
```

默认打开：**http://localhost:$PORT**（默认 `8787`）

| 变量 | 说明 |
|------|------|
| `PORT` / `HOST` | 监听地址，默认 `8787` / `0.0.0.0` |
| `WEB_PORT` / `WEB_HOST` | 仅开发态 Vite；生产单进程不走 Vite |
| `WEB_DIST` | Vite 产物目录（相对 **进程 cwd**）。Docker 内为 `public`；本机可省略，会依次尝试 `public`、`apps/web/dist` 等 |
| `DANDAN_*` 等 | 同开发环境，见 `.env.example` |

进程 cwd 一般是 `apps/server`（`pnpm --filter @aniku/server start`），此时相对路径 `../web/dist` 也会被探测到。

**反向代理（可选）：** 前面可再挂 Nginx/Caddy 做 HTTPS；只需把流量转到 `$PORT`，无需再拆前后端。

### 6. Docker / Compose

仓库根目录提供 `Dockerfile`、`docker-compose.yml`、`.dockerignore`。生产镜像为 **单进程**：Hono 同时提供 `/api/*` 与 SPA。

```bash
cp .env.example .env   # 按需改 PORT / WEB_PORT
docker compose up -d --build

# 日志 / 停止
docker compose logs -f
docker compose down
```

端口（读根目录 `.env`，Compose 变量插值）：

| 变量 | 默认 | 作用 |
|------|------|------|
| `WEB_PORT` | `5173` | **浏览器入口**（宿主机发布端口） |
| `PORT` | `8787` | 容器内 Hono 监听端口；映射关系为 `WEB_PORT → PORT` |

- 访问：**http://localhost:$WEB_PORT**（默认 5173；SPA 与 `/api` 同源）  
- 镜像内：`WEB_DIST=public`，健康检查 `GET /api/health`  
- 仅 Docker 构建（不 compose）：

```bash
docker build -t aniku .
docker run --rm -p 5173:8787 --env-file .env -e PORT=8787 aniku
# 或：-p ${WEB_PORT}:${PORT} -e PORT=${PORT}
```

### 7. 使用流程

1. 本地 dev：打开 http://localhost:$WEB_PORT（默认 5173）；Docker：同样打开 **WEB_PORT**  

2. **设置 → Bangumi Token**（可选，用于追番）  
3. 规则默认已内置（`7sefun` / `MXdm`）；也可 **导入 JSON** 或在 **规则仓库** 中安装 / 更新  
4. 详情页 → **选源播放** → 选集  
5. 播放页自动尝试匹配弹幕  

### 常见问题

| 现象 | 处理 |
|------|------|
| `pnpm: command not found` | 按上文安装 pnpm，并确认 `PATH` 含全局 bin |
| `Local package.json exists, but node_modules missing` / `spawn ENOENT`（`tsx watch …`） | 在**仓库根**执行 `pnpm install` 后再 `pnpm dev` |
| 页面请求 `/api/*` 全失败 | 确认 `pnpm dev` 起了 server，`$PORT` 在监听，且 `WEB_PORT`/`PORT` 与 Vite 代理一致；不要只开 `dev:web` 却期望代理后端 |
| 在 `apps/server` 里直接跑脚本异常 | 优先在根目录用 `pnpm dev` / `pnpm --filter @aniku/server dev` |
| 弹幕「未配置」 | 本地可留空 `DANDAN_*`；若仍异常检查服务端日志与 `/api/danmaku/status` |
| 只有声音没有画面 | 多为布局/合成问题，不是流地址必挂；见 [docs/CONTEXT.md](docs/CONTEXT.md) |


## 目录

```
aniku/
  apps/web/          # 前端 @aniku/web
  apps/server/       # 代理与规则引擎（生产可托管 SPA）@aniku/server
  packages/shared/   # 类型与 DTO @aniku/shared
  docs/CONTEXT.md    # 开发者上下文（架构 / 约定 / 踩坑）
  CLAUDE.md          # AI 助手约定
  Dockerfile         # 单镜像：API + 静态前端
  docker-compose.yml
  .env.example
```

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
| `GET /api/danmaku/*` | 弹弹代理（status / search / bangumi / comment） |
| `POST /api/plugin/search\|chapters\|resolve` | 规则执行 |
| `GET /api/plugin/catalog` | KazumiRules 目录（`?mirror=1` 镜像） |
| `GET /api/plugin/catalog/:name` | 下载单条规则 JSON |
| `GET /api/media/proxy` | 媒体流代理 |

## 快捷键（播放）

| 键 | 作用 |
|----|------|
| Space / K | 播放 / 暂停 |
| ← / → | 快退 / 快进 5s |
| ↑ / ↓ | 音量 |
| F | 播放器全屏 / 退出（控制栏另有「网页全屏」直达按钮） |
| D | 弹幕开关 |
| , | 弹幕滞后 0.5s（偏移 +0.5） |
| . | 弹幕超前 0.5s（偏移 −0.5） |
| / | 弹幕偏移复位 |
| Alt+M | 弹幕面板（搜索 / 设置 / 导入） |
| P / N | 上一集 / 下一集 |
| 拖入 .xml | 加载 B 站 / pakku 弹幕文件 |

控制栏：播放、上/下集、进度、弹幕、倍速、音量、全屏、网页全屏。

设置页可配置：倍速默认、自动下一集、记忆进度、跳过片头/片尾。播放器内也可调倍速 / 画质相关控件。

## 说明与免责

- 默认内置少量示例规则；更多规则请从兼容的 [KazumiRules](https://github.com/Predidit/KazumiRules) 安装或自行导入。  
- 元数据来自 [Bangumi](https://bangumi.tv/)，弹幕来自 [弹弹play](https://www.dandanplay.com/)。  
- 使用需遵守所在地法律法规；因使用本项目产生的缓存数据建议在 24 小时内清除。  
- 部分站点有反爬 / 验证码 / 反盗链，Web 端解析可能失败，可换规则或线路。

规则格式与社区生态兼容 [KazumiRules](https://github.com/Predidit/KazumiRules)；实现上曾参考 [Kazumi](https://github.com/Predidit/Kazumi) 与 [agefans-enhance](https://github.com/IronKinoko/agefans-enhance)。
