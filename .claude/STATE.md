# Aniku 项目状态

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
