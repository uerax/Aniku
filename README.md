# Kazumi Web

浏览器端的番剧浏览 / 选源播放 / 弹幕 / Bangumi 追番应用。

> **仅 Web**：本仓库是 React 网页 + 本地 API 代理，不是 Flutter / 桌面安装包。  
> 仓库：https://github.com/uerax/Kazumi-web

**开发者：** 架构约定、规则引擎、播放器/弹幕设计与踩坑见 [docs/CONTEXT.md](docs/CONTEXT.md)。  
给 AI 助手的工作约定见 [CLAUDE.md](CLAUDE.md)。

## 参考项目与功能来源

本项目在浏览器里复现「桌面选源 + 网页弹幕」体验，功能主要对照下列两个开源项目设计与实现（模式参考，非代码照搬）：

| 参考项目 | 形态 | 本仓库主要借鉴的功能 |
|----------|------|----------------------|
| [Kazumi](https://github.com/Predidit/Kazumi) | Flutter 桌面 / 移动客户端 | Bangumi 元数据与追番；[KazumiRules](https://github.com/Predidit/KazumiRules) 兼容规则（XPath / API 模式）；搜索关键词策略与选源 UX；弹弹 play 弹幕匹配；历史进度；片头片尾跳过等播放偏好 |
| [agefans-enhance](https://github.com/IronKinoko/agefans-enhance) | 油猴脚本 | Web 侧弹幕渲染（[@ironkinoko/danmaku](https://github.com/IronKinoko/danmaku)）；弹弹 API 鉴权思路；播放器内弹幕面板（搜索 / 设置 / 过滤）；XML 拖入；弹幕偏移与快捷键体验 |

**能力边界（相对参考项目）：**

- 相对 **Kazumi**：无内嵌 WebView 媒体拦截，部分源只能静态 HTML 解析或 iframe 降级，成功率通常低于桌面端。
- 相对 **agefans-enhance**：不是站点油猴注入，而是独立 SPA + 本地 API；多源规则与 Bangumi 整站流程来自 Kazumi 侧。

## 功能

| 模块 | 说明 | 主要参考 |
|------|------|----------|
| 首页 / 时间表 / 搜索 | Bangumi 元数据 | Kazumi |
| 详情 | 简介、分集、收藏状态、选源 | Kazumi |
| 规则插件 | 内置默认规则 + 本地导入 + [KazumiRules](https://github.com/Predidit/KazumiRules) 仓库安装 | Kazumi |
| 播放 | 原生 video + [hls.js](https://github.com/video-dev/hls.js)（HLS/MP4、倍速、热键、全屏）+ 自动下一集 / 续播 / 跳过片头片尾 | Kazumi（偏好）+ 本项目实现 |
| 弹幕 | 弹弹play 自动匹配 + 播放器内弹幕面板 + [@ironkinoko/danmaku](https://github.com/IronKinoko/danmaku)；XML 拖入 / B 站 BV | Kazumi + agefans-enhance |
| 追番 | Bangumi Access Token 同步收藏 | Kazumi |
| 历史 | 本地播放进度 | Kazumi |

## 技术栈

- `apps/web` — React + Vite + TypeScript + Tailwind + TanStack Query + Zustand
- `apps/server` — Hono（Bangumi / 弹弹 / 规则引擎 / 媒体代理）
- `packages/shared` — 共享类型

## 快速开始

### 1. 安装依赖

```bash
cd kazumi-web
pnpm install
```

### 2. 环境变量

```bash
cp .env.example .env
```

编辑 `.env`（可选）：

```env
# 弹幕开放平台密钥（申请：https://www.dandanplay.com/ ）
# 留空时使用与 agefans-enhance 相同的内置客户端密钥，开箱即可匹配弹幕
DANDAN_APP_ID=
DANDAN_APP_SECRET=
```

不填密钥也能拉弹幕；若日后内置密钥失效，再自行申请并写入即可。

### 3. 启动（Web + API）

```bash
pnpm dev
```

- 网页：http://localhost:5173  
- API：http://localhost:8787（Vite 已将 `/api` 代理到此）

### 4. 使用流程

1. 打开首页浏览趋势，或去搜索 / 时间表  
2. **设置 → Bangumi Token**（可选，用于追番）  
3. 规则默认已内置（`7sefun` / `MXdm`）；也可 **导入 JSON** 或在 **规则仓库** 中安装 / 更新  
4. 详情页 → **选源播放** → 选集  
5. 播放页自动尝试匹配弹幕  

## 目录

```
kazumi-web/
  apps/web/          # 前端
  apps/server/       # 代理与规则引擎
  packages/shared/   # 类型与 DTO
  docs/CONTEXT.md    # 开发者上下文（架构 / 约定 / 踩坑）
  CLAUDE.md          # AI 助手约定
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
| F | 播放器全屏 / 退出（控制栏「全屏」可选手动：播放器 / 浏览器 / 网页全屏） |
| D | 弹幕开关 |
| , | 弹幕滞后 0.5s（偏移 +0.5） |
| . | 弹幕超前 0.5s（偏移 −0.5） |
| / | 弹幕偏移复位 |
| Alt+M | 弹幕面板（搜索 / 设置 / 导入） |
| P / N | 上一集 / 下一集 |
| 拖入 .xml | 加载 B 站 / pakku 弹幕文件 |

控制栏：播放、上/下集、进度、弹幕、倍速、音量、全屏。

设置页可配置：倍速默认、自动下一集、记忆进度、跳过片头/片尾。播放器内也可调倍速 / 画质相关控件。

## 说明与免责

- 默认内置与 Kazumi 相同的少量示例规则；更多规则请从 [KazumiRules](https://github.com/Predidit/KazumiRules) 安装或自行导入。  
- 元数据来自 [Bangumi](https://bangumi.tv/)，弹幕来自 [弹弹play](https://www.dandanplay.com/)。  
- 使用需遵守所在地法律法规；因使用本项目产生的缓存数据建议在 24 小时内清除。  
- 部分站点有反爬 / 验证码 / 反盗链，Web 端解析可能失败，可换规则或使用桌面版 Kazumi。

## 与参考项目的对照

| 能力 | [Kazumi](https://github.com/Predidit/Kazumi) | [agefans-enhance](https://github.com/IronKinoko/agefans-enhance) | 本项目 |
|------|--------|-----------------|--------|
| 规则采集 | ✅ | 按站点写适配脚本 | ✅（服务端 XPath + API 规则） |
| Bangumi 元数据 / 追番 | ✅ | ❌ | ✅ |
| 弹弹 play 弹幕 | ✅ | ✅ | ✅ |
| 弹幕面板 / XML / ironkinoko 渲染 | 客户端 UI | ✅（油猴内嵌） | ✅（Web 播放器内） |
| WebView 拦媒体流 | ✅ | 部分依赖页内播放器 | ❌（静态解析；失败可 iframe 降级） |
| 超分 / 一起看 / 下载 | ✅ | ❌ | ❌（未做） |
| 运行形态 | 客户端 App | 油猴 | **纯 Web**（React + 本地 Hono） |

感谢 [Predidit/Kazumi](https://github.com/Predidit/Kazumi) 与 [IronKinoko/agefans-enhance](https://github.com/IronKinoko/agefans-enhance) 提供的产品与实现参考。
