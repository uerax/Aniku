import type { ReactNode } from 'react'

/**
 * Desktop cinema: player | rail
 *                 meta   | (rail continues)
 * Sources/eps max-height capped to avoid nested page scroll fights.
 */
export function DesktopWatchLayout({
  player,
  meta,
  rail,
}: {
  player: ReactNode
  meta: ReactNode
  rail: ReactNode
}) {
  return (
    <div className="kz-watch-cinema kz-watch-cinema--desktop grid items-start px-4 sm:px-0 lg:grid-cols-[minmax(0,1fr)_var(--kz-watch-rail-w)] lg:gap-[var(--kz-watch-cinema-gap)]">
      <div className="kz-player-stack min-w-0 space-y-3">
        {player}
        {meta}
      </div>
      <aside className="kz-watch-rail flex flex-col gap-3">{rail}</aside>
    </div>
  )
}
