import type { ReactNode } from 'react'

/**
 * Mobile watch stack (top → bottom):
 * 1. cover + intro
 * 2. 选集 (above player — quicker ep switch without scrolling past video)
 * 3. player + danmaku status
 * 4. 视频源
 *
 * No nested max-height — page scroll only.
 * #kz-watch-focus anchors auto-scroll after picking a source result.
 */
export function MobileWatchLayout({
  meta,
  episodes,
  player,
  sources,
}: {
  meta: ReactNode
  /** Episode picker — rendered above the player on mobile only */
  episodes: ReactNode
  player: ReactNode
  sources: ReactNode
}) {
  return (
    <div className="kz-watch-cinema kz-watch-cinema--mobile space-y-3 px-4">
      {meta}
      {/* Cinema focus: 选集 + 播放器 — scroll target after source pick */}
      <div
        id="kz-watch-focus"
        className="kz-watch-focus scroll-mt-16 space-y-3"
      >
        <div className="min-w-0">{episodes}</div>
        <div className="kz-player-stack min-w-0 space-y-2">{player}</div>
      </div>
      <div className="min-w-0">{sources}</div>
    </div>
  )
}
