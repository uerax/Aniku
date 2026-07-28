import { useEffect, useRef } from 'react'
import clsx from 'clsx'

export type MobileEpsRoad = {
  name?: string
  identifier: string[]
  data: string[]
}

/**
 * Bilibili 正片侧栏风格选集（桌面 rail + 移动共用）:
 *  选集 (n/N)                 全 N 话 ⌄
 *  [线路 soft pills]
 *  [横向圆角集卡 | 全量网格]
 *
 * 集卡形状：横向圆角矩形（非 bilibili 数字方格），保证「第01集」可读。
 * 行为钩子保留：listExpanded / data-ep-index；展开与折叠横条均为约 4 列。
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
  const roadsRef = useRef<HTMLDivElement>(null)

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

  // Keep active road pill in view when many lines overflow horizontally
  useEffect(() => {
    const root = roadsRef.current
    if (!root) return
    const tab = root.querySelector<HTMLElement>(
      `[data-road-index="${activeRoadIndex}"]`,
    )
    tab?.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    })
  }, [activeRoadIndex, roads.length])

  const countLabel =
    epCount > 0
      ? playingEpisode && playingEpisode > 0
        ? `(${playingEpisode}/${epCount})`
        : `(${epCount})`
      : ''

  return (
    <section className="kz-watch-eps kz-watch-eps--mobile kz-watch-panel min-w-0 max-w-full overflow-hidden">
      <div className="kz-bili-sec-head">
        <h2 className="kz-bili-sec-title">
          选集
          {countLabel ? (
            <span className="kz-bili-sec-count">{countLabel}</span>
          ) : null}
        </h2>
        <button
          type="button"
          onClick={onToggleList}
          className="kz-bili-sec-more"
          aria-expanded={listExpanded}
        >
          {epCount > 0 ? `全${epCount}话` : '全部'}
          <svg
            className="kz-bili-chevron"
            data-open={listExpanded ? 'true' : 'false'}
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden
          >
            <path
              d="M4 6.2L8 10.2L12 6.2"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {showRoads && (
        <div
          ref={roadsRef}
          className="kz-bili-roads"
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
                data-road-index={ri}
                aria-selected={active}
                onClick={() => onSelectRoad(ri)}
                className={clsx(
                  'kz-bili-road',
                  active && 'kz-bili-road--active',
                )}
                title={label}
              >
                <span className="kz-bili-road-label">{label}</span>
                {playingHere && !active ? (
                  <span className="kz-bili-road-live">在播</span>
                ) : null}
              </button>
            )
          })}
        </div>
      )}

      <div className="kz-watch-eps-body kz-bili-eps-body">
        {roadLoading && (
          <p className="kz-bili-empty">
            加载分集
            {pendingPluginName ? `（${pendingPluginName}）` : ''}
            …
          </p>
        )}
        {roadError && <p className="kz-bili-error">{roadError}</p>}
        {!hasSelection && !roadLoading && (
          <div className="kz-bili-hint">
            <p>
              <span className="kz-watch-step">1</span>
              在「视频源」点规则搜索
            </p>
            <p>
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
              listExpanded
                ? 'kz-bili-ep-grid'
                : 'kz-bili-ep-strip',
            )}
          >
            {activeRoad.identifier.map((name, epIndex) => {
              const playing =
                playingRoad === activeRoadIndex &&
                playingEpisode === epIndex + 1
              const label = name?.trim() || String(epIndex + 1)
              return (
                <button
                  key={activeRoad.data[epIndex] + name + epIndex}
                  type="button"
                  data-ep-index={epIndex}
                  onClick={() => onPickEpisode(epIndex, activeRoadIndex)}
                  title={label}
                  className={clsx(
                    'kz-watch-ep-card kz-bili-ep',
                    playing && 'kz-bili-ep--playing',
                  )}
                >
                  {playing ? (
                    <span className="kz-bili-ep-bars" aria-hidden>
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : null}
                  <span className="kz-bili-ep-text">{label}</span>
                </button>
              )
            })}
          </div>
        )}
        {hasSelection && !roadLoading && !activeRoad && roads.length > 0 && (
          <p className="kz-bili-empty">请选择上方线路查看集数</p>
        )}
      </div>
    </section>
  )
}
