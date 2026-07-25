# Aniku 项目状态

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
