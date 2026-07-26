import type { ReactNode } from 'react'

/**
 * Mobile watch stack (Bilibili web mobile–style), top → bottom:
 * 1. player (+ danmaku status) — portrait sticky under header
 * 2. compact meta (2 lines, expand for full)
 * 3. 视频源
 * 4. 选集
 *
 * Landscape: same order, no sticky (see plyr-overrides).
 * #kz-watch-focus anchors auto-scroll after picking a source result.
 */
export function MobileWatchLayout({
  meta,
  episodes,
  player,
  sources,
}: {
  meta: ReactNode
  episodes: ReactNode
  player: ReactNode
  sources: ReactNode
}) {
  return (
    <div className="kz-watch-cinema kz-watch-cinema--mobile space-y-3 px-4">
      <div
        id="kz-watch-focus"
        className="kz-watch-focus kz-player-stack kz-player-stack--sticky min-w-0 scroll-mt-[var(--kz-header-offset,3.5rem)] space-y-2"
      >
        {player}
      </div>
      <div className="kz-watch-meta min-w-0">{meta}</div>
      <div className="min-w-0">{sources}</div>
      <div className="min-w-0">{episodes}</div>
    </div>
  )
}
