# Bug / 优化清单

## [2026-07-26] iOS Safari 首页继续观看卡片超宽

- 状态：已完成
- 优先级：P1
- 描述：继续观看视频卡片宽度超出热门趋势等其他模块
- 涉及文件：HomePage.tsx、Layout.tsx
- 备注：iOS grid min-width:auto；min-w-0 + truncate 修复

## [2026-07-26] 移动端双击无法暂停

- 状态：已完成
- 优先级：P0
- 描述：双击舞台应 pause，实际像没暂停（或闪一下又继续播）
- 涉及文件：apps/web/src/player/chrome/useShellPointerHandlers.ts
- 备注：click 双击检测 + dblclick 各调一次 togglePlay；PLAY_TOGGLE_DEDUP_MS=420 去重

## [2026-07-26] 播放中瞬间闪「缓冲中…」

- 状态：已完成
- 优先级：P0
- 描述：画面流畅时仍偶尔弹出缓冲提示并瞬间消失 → 改为仅无可播数据时中间转圈，去掉文案
- 涉及文件：apps/web/src/player/VideoPlayer.tsx、plyr-overrides.css
- 备注：能播静默；underrun/seek hole/首载才 spinner；HLS non-fatal 不亮 UI

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