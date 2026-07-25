# Bug / 优化清单

## [2026-07-26] 桌面端视频源与选集共用 rail 滚动

- 状态：已完成
- 优先级：P1
- 描述：桌面端右侧 rail 对「视频源 + 选集」整体设 max-height + overflow-y，两块高度叠加后出现外层莫名滚动条；应各自独立板块、各自限高滚动
- 涉及文件：apps/web/src/player/plyr-overrides.css, apps/web/src/pages/WatchPage.tsx, apps/web/src/pages/watch/DesktopWatchLayout.tsx
- 备注：去掉 rail 外层 overflow；sources/eps 各自 body 限高；eps 增加 kz-watch-eps class

## [2026-07-26] Anime1 搜索噪声：动画列表 / 季度新番

- 状态：已完成
- 优先级：P2
- 描述：Anime1 内置源搜索结果混入「动画列表」「季度新番」等站点导航/列表页，应过滤
- 涉及文件：apps/server/src/lib/anime1.ts
- 备注：按标题（列表/新番/留言板…）+ 仅保留 /数字 集页 URL 双过滤