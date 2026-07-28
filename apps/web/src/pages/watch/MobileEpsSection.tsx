import { useEffect, useRef } from 'react'
import clsx from 'clsx'

export type MobileEpsRoad = {
  name?: string
  identifier: string[]
  data: string[]
}

/**
 * Bilibili-style 选集 (shared mobile + desktop rail):
 *  选集                    全 N 话
 *  [线路 pill tabs]
 *  [horizontal episode cards | full grid]
 *
 * Behavior hooks preserved: listExpanded, data-ep-index scroll, 4/3-col grid.
 */
export function MobileEpsSection({
  roads,
  activeRoadIndex,
  playingRoad,
  playingEpisode,
  epCount,
  listExpanded,
  roadLoading,
  roadError,
  pendingPluginName,
  hasSelection,
  onToggleList,
  onSelectRoad,
  onPickEpisode,
}: {
  roads: MobileEpsRoad[]
  activeRoadIndex: number
  playingRoad?: number | null
  /** 1-based episode number currently playing on playingRoad */
  playingEpisode?: number | null
  epCount: number
  listExpanded: boolean
  roadLoading?: boolean
  roadError?: string | null
  pendingPluginName?: string | null
  hasSelection: boolean
  onToggleList: () => void
  onSelectRoad: (index: number) => void
  onPickEpisode: (epIndex: number, roadIndex: number) => void
}) {
  const activeRoad = roads[activeRoadIndex]
  const showRoads = roads.length > 0
  const stripRef = useRef<HTMLDivElement>(null)

  // Keep the playing card visible in the horizontal strip
  useEffect(() => {
    if (listExpanded) return
    if (playingRoad !== activeRoadIndex) return
    if (!playingEpisode || playingEpisode < 1) return
    const root = stripRef.current
    if (!root) return
    const card = root.querySelector<HTMLElement>(
      `[data-ep-index="${playingEpisode - 1}"]`,
    )
    card?.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    })
  }, [listExpanded, playingRoad, playingEpisode, activeRoadIndex, activeRoad])

  return (
    <section className="kz-watch-eps kz-watch-eps--mobile kz-watch-panel min-w-0 overflow-hidden px-3 py-2 text-xs">
      <div className="flex items-center gap-2 leading-none">
        <h2 className="kz-watch-panel-title min-w-0 flex-1">选集</h2>
        <button
          type="button"
          onClick={onToggleList}
          className="shrink-0 rounded-full bg-[var(--kz-bg-soft)] px-2 py-0.5 text-xs font-medium text-[var(--kz-fg-muted)] transition hover:bg-[var(--kz-bg-hover)] hover:text-[var(--kz-fg)]"
          aria-expanded={listExpanded}
        >
          {epCount > 0 ? `全${epCount}话` : '全部'}
          <span className="ml-0.5 inline-block translate-y-px text-[10px] opacity-70">
            {listExpanded ? '∨' : '>'}
          </span>
        </button>
      </div>

      {showRoads && (
        <div
          className="kz-watch-roads mt-2 flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="播放线路"
        >
          {roads.map((road, ri) => {
            const active = ri === activeRoadIndex
            const playingHere = playingRoad === ri
            const label = road.name?.trim() || `线路 ${ri + 1}`
            return (
              <button
                key={`${label}-${ri}`}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelectRoad(ri)}
                className={clsx(
                  'kz-watch-road-tab shrink-0 rounded-full px-2.5 py-1 text-xs font-medium leading-none transition',
                  active
                    ? 'bg-[var(--kz-accent-soft)] text-[var(--kz-accent)]'
                    : 'bg-[var(--kz-bg-soft)] text-[var(--kz-fg-muted)] hover:text-[var(--kz-fg)]',
                )}
                title={label}
              >
                {label}
                {playingHere && !active ? (
                  <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-[var(--kz-accent)]">
                    <span
                      className="inline-block h-1 w-1 rounded-full bg-current"
                      aria-hidden
                    />
                    在播
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      )}

      <div className="kz-watch-eps-body mt-2">
        {roadLoading && (
          <p className="py-5 text-center text-xs text-[var(--kz-fg-muted)]">
            加载分集
            {pendingPluginName ? `（${pendingPluginName}）` : ''}
            …
          </p>
        )}
        {roadError && (
          <p className="px-1 py-2 text-xs text-[var(--kz-danger)]">{roadError}</p>
        )}
        {!hasSelection && !roadLoading && (
          <div className="flex flex-col items-center gap-2 py-5 text-xs leading-relaxed text-[var(--kz-fg-muted)]">
            <p className="flex items-center gap-2">
              <span className="kz-watch-step">1</span>
              在「视频源」点规则搜索
            </p>
            <p className="flex items-center gap-2">
              <span className="kz-watch-step">2</span>
              再点搜出的番剧条目加载分集
            </p>
          </div>
        )}
        {hasSelection && !roadLoading && activeRoad && (
          <div
            ref={stripRef}
            className={clsx(
              'kz-watch-ep-strip',
              /* p-[3px]: room for selected ring so overflow-x doesn't clip it */
              listExpanded
                ? /* mobile 4 cols; desktop rail ~320px → 3 — density preserved */
                  'grid grid-cols-4 gap-1.5 p-[3px] lg:grid-cols-3'
                : 'flex gap-1.5 overflow-x-auto p-[3px] pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            )}
          >
            {activeRoad.identifier.map((name, epIndex) => {
              const playing =
                playingRoad === activeRoadIndex &&
                playingEpisode === epIndex + 1
              // Source-provided title only (no synthetic「第 N 话」); bare index if empty
              const label = name?.trim() || String(epIndex + 1)
              return (
                <button
                  key={activeRoad.data[epIndex] + name + epIndex}
                  type="button"
                  data-ep-index={epIndex}
                  onClick={() => onPickEpisode(epIndex, activeRoadIndex)}
                  title={label}
                  className={clsx(
                    'kz-watch-ep-card flex items-center justify-center rounded-lg px-1.5 py-2 text-center transition',
                    listExpanded ? 'min-w-0' : 'w-[4.75rem] shrink-0',
                    playing
                      ? 'kz-watch-ep-card--playing bg-[var(--kz-accent-soft)] ring-1 ring-inset ring-[var(--kz-accent)]/45'
                      : 'bg-[var(--kz-bg-soft)] hover:bg-[var(--kz-bg-hover)]',
                  )}
                >
                  <div
                    className={clsx(
                      'flex items-center justify-center gap-0.5 text-[11px] leading-snug',
                      playing
                        ? 'font-semibold text-[var(--kz-accent)]'
                        : 'font-normal text-[var(--kz-fg)]',
                    )}
                  >
                    {playing ? (
                      <span
                        className="inline-flex h-3 w-2.5 shrink-0 items-end justify-center gap-px"
                        aria-hidden
                      >
                        <span className="h-1 w-0.5 animate-pulse rounded-sm bg-current" />
                        <span className="h-2 w-0.5 animate-pulse rounded-sm bg-current [animation-delay:120ms]" />
                        <span className="h-1.5 w-0.5 animate-pulse rounded-sm bg-current [animation-delay:240ms]" />
                      </span>
                    ) : null}
                    <span className="min-w-0 truncate">{label}</span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
        {hasSelection && !roadLoading && !activeRoad && roads.length > 0 && (
          <p className="py-5 text-center text-xs text-[var(--kz-fg-muted)]">
            请选择上方线路查看集数
          </p>
        )}
      </div>
    </section>
  )
}
