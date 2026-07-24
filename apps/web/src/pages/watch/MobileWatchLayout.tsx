import type { ReactNode } from 'react'

/**
 * Mobile watch stack (top → bottom):
 * 1. cover + intro
 * 2. player
 * 3. 视频源 / 选集 (no max-height — page scroll only, no nested scroll fights)
 */
export function MobileWatchLayout({
  meta,
  player,
  rail,
}: {
  meta: ReactNode
  player: ReactNode
  rail: ReactNode
}) {
  return (
    <div className="kz-watch-cinema kz-watch-cinema--mobile space-y-3 px-4">
      {meta}
      <div className="kz-player-stack min-w-0 space-y-2">{player}</div>
      <div className="flex flex-col gap-3">{rail}</div>
    </div>
  )
}
