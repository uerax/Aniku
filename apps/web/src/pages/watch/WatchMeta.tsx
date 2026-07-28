import { Link } from 'react-router-dom'
import {
  CollectType,
  CollectTypeLabel,
  airProgressLabel,
  coverOf,
  estimateAirProgress,
  type BangumiItem,
} from '@animaku/shared'

/**
 * Collapsed mobile bar — keep text-xs + py-2 so height stays aligned with
 * the 弹幕 status strip (behavior constraint; do not inflate padding).
 */
const META_BAR =
  'kz-watch-panel flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-xs font-normal leading-none text-[var(--kz-fg-muted)] transition hover:bg-[var(--kz-bg-hover)]'
const META_TOGGLE =
  'kz-watch-panel-action shrink-0 text-xs hover:underline'

function airChipClass(
  status: ReturnType<typeof estimateAirProgress>['status'],
): string {
  switch (status) {
    case 'finished':
      return 'kz-watch-chip kz-watch-chip-air-finished'
    case 'airing':
      return 'kz-watch-chip kz-watch-chip-air-airing'
    case 'upcoming':
      return 'kz-watch-chip kz-watch-chip-air-upcoming'
    default:
      return 'kz-watch-chip'
  }
}

function MetaChips({ item }: { item: BangumiItem }) {
  const airLabel = airProgressLabel(item)
  const air = estimateAirProgress(item)
  return (
    <div className="flex flex-wrap gap-1.5">
      {item.ratingScore > 0 && (
        <span className="kz-watch-chip kz-watch-chip-score tabular-nums">
          ★ {item.ratingScore.toFixed(1)}
        </span>
      )}
      {airLabel && (
        <span className={airChipClass(air.status)}>{airLabel}</span>
      )}
      {item.airDate && <span className="kz-watch-chip">{item.airDate}</span>}
      {item.tags?.slice(0, 6).map((t) => (
        <span key={t.name} className="kz-watch-chip max-w-[8rem] truncate">
          {t.name}
        </span>
      ))}
    </div>
  )
}

function MetaSubline({
  pluginName,
  episodeLabel,
  mediaHint,
  className = 'truncate text-[13px] text-[var(--kz-fg-muted)]',
}: {
  pluginName?: string
  episodeLabel?: string | null
  mediaHint?: string | null
  className?: string
}) {
  const parts: string[] = []
  if (pluginName) parts.push(pluginName)
  else parts.push('未选源')
  if (episodeLabel) parts.push(episodeLabel)
  if (mediaHint) parts.push(mediaHint)
  return <p className={className}>{parts.join(' · ')}</p>
}

function CollectControl({
  token,
  collectType,
  collectOptions,
  onCollectChange,
  collectPending,
  compact,
}: {
  token: string
  collectType: CollectType
  collectOptions: CollectType[]
  onCollectChange: (t: CollectType) => void
  collectPending?: boolean
  compact?: boolean
}) {
  if (!token) {
    return (
      <Link
        to="/settings"
        className={
          compact
            ? 'text-xs text-[var(--kz-fg-muted)] hover:text-[var(--kz-accent)]'
            : 'text-[13px] text-[var(--kz-fg-muted)] hover:text-[var(--kz-accent)]'
        }
      >
        登录 Bangumi 同步追番
      </Link>
    )
  }
  return (
    <select
      value={collectType}
      onChange={(e) => onCollectChange(Number(e.target.value) as CollectType)}
      className={
        compact
          ? 'rounded-lg border border-[var(--kz-border)] bg-[var(--kz-bg)] px-2 py-0.5 text-xs'
          : 'rounded-lg border border-[var(--kz-border)] bg-[var(--kz-bg)] px-2.5 py-1 text-[13px]'
      }
      disabled={collectPending}
    >
      <option value={CollectType.none}>未收藏</option>
      {collectOptions.map((t) => (
        <option key={t} value={t}>
          {CollectTypeLabel[t]}
        </option>
      ))}
    </select>
  )
}

export function WatchMeta({
  item,
  title,
  pluginName,
  episodeLabel,
  mediaHint,
  summaryOpen,
  onToggleSummary,
  token,
  collectType,
  collectOptions,
  onCollectChange,
  collectPending,
  compact,
  /** Mobile: whole card collapsed to brief bar until expanded */
  metaOpen = true,
  onToggleMeta,
}: {
  item: BangumiItem | null | undefined
  title: string
  pluginName?: string
  episodeLabel?: string | null
  mediaHint?: string | null
  summaryOpen: boolean
  onToggleSummary: () => void
  token: string
  collectType: CollectType
  collectOptions: CollectType[]
  onCollectChange: (t: CollectType) => void
  collectPending?: boolean
  /** Mobile layout: enable bar-style collapsed chrome */
  compact?: boolean
  metaOpen?: boolean
  onToggleMeta?: () => void
}) {
  /* Mobile collapsed — height locked to 弹幕 bar (xs + py-2) */
  if (compact && !metaOpen) {
    return (
      <div className="kz-watch-meta">
        <button
          type="button"
          onClick={onToggleMeta}
          className={META_BAR}
          aria-expanded={false}
        >
          <span
            className="h-3 w-0.5 shrink-0 rounded-full bg-[var(--kz-accent)]/70"
            aria-hidden
          />
          <span className="kz-watch-panel-title">简介</span>
          <span className="min-w-0 flex-1 truncate text-xs font-normal text-[var(--kz-fg)]">
            {title}
            {(episodeLabel || pluginName || mediaHint) && (
              <span className="text-xs font-normal text-[var(--kz-fg-muted)]">
                {' · '}
                {[episodeLabel, pluginName, mediaHint]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
          </span>
          <span className={META_TOGGLE}>展开</span>
        </button>
      </div>
    )
  }

  /* Mobile expanded */
  if (compact) {
    return (
      <div className="kz-watch-meta kz-watch-panel space-y-2.5 px-3 py-2.5 text-[var(--kz-fg-muted)]">
        <div className="flex items-start gap-2.5">
          {item && coverOf(item, 'thumb') ? (
            <div className="h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-[var(--kz-bg-soft)] shadow-sm ring-1 ring-[var(--kz-border)]">
              <img
                src={coverOf(item, 'thumb')}
                alt=""
                loading="lazy"
                decoding="async"
                width={48}
                height={64}
                className="h-full w-full object-cover"
              />
            </div>
          ) : null}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-start gap-2">
              <h1 className="min-w-0 flex-1 text-sm font-semibold leading-snug tracking-tight text-[var(--kz-fg)]">
                {title}
              </h1>
              {onToggleMeta ? (
                <button
                  type="button"
                  onClick={onToggleMeta}
                  className={META_TOGGLE}
                  aria-expanded={true}
                >
                  收起
                </button>
              ) : null}
            </div>
            {item?.nameCn && item.name && item.nameCn !== item.name && (
              <p className="truncate text-xs text-[var(--kz-fg-muted)]">
                {item.name}
              </p>
            )}
            <MetaSubline
              pluginName={pluginName}
              episodeLabel={episodeLabel}
              mediaHint={mediaHint}
              className="truncate text-xs text-[var(--kz-fg-muted)]"
            />
          </div>
        </div>

        {item && <MetaChips item={item} />}

        {item?.summary && (
          <div className="text-xs leading-relaxed text-[var(--kz-fg-muted)]">
            <p className={summaryOpen ? '' : 'line-clamp-2'}>{item.summary}</p>
            {item.summary.length > 60 && (
              <button
                type="button"
                className="mt-0.5 text-xs font-medium text-[var(--kz-accent)] hover:underline"
                onClick={onToggleSummary}
              >
                {summaryOpen ? '收起简介' : '展开简介'}
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <CollectControl
            token={token}
            collectType={collectType}
            collectOptions={collectOptions}
            onCollectChange={onCollectChange}
            collectPending={collectPending}
            compact
          />
          {item?.alias && item.alias.length > 0 && (
            <span className="text-xs text-[var(--kz-fg-dim)]">
              别名 {item.alias.length} 个
            </span>
          )}
        </div>
      </div>
    )
  }

  /* Desktop — elevated meta card */
  return (
    <div className="kz-watch-meta kz-watch-panel flex gap-3.5 p-3.5 sm:gap-4 sm:p-4">
      {item && coverOf(item, 'thumb') ? (
        <div className="h-[7.75rem] w-[5.75rem] shrink-0 overflow-hidden rounded-xl bg-[var(--kz-bg-soft)] shadow-sm ring-1 ring-[var(--kz-border)] sm:h-36 sm:w-[6.75rem]">
          {/* ~108px CSS wide — thumb/r400 is enough; large was a common LCP sink */}
          <img
            src={coverOf(item, 'thumb')}
            alt=""
            loading="eager"
            decoding="async"
            fetchPriority="low"
            width={108}
            height={144}
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}
      <div className="min-w-0 flex-1 space-y-2">
        <h1 className="text-lg font-semibold leading-snug tracking-tight text-[var(--kz-fg)] sm:text-xl">
          {title}
        </h1>
        {item?.nameCn && item.name && item.nameCn !== item.name && (
          <p className="text-[13px] text-[var(--kz-fg-muted)]">{item.name}</p>
        )}
        <MetaSubline
          pluginName={pluginName}
          episodeLabel={episodeLabel}
          mediaHint={mediaHint}
        />
        {item && <MetaChips item={item} />}
        {item?.summary && (
          <div className="text-[13px] leading-relaxed text-[var(--kz-fg-muted)]">
            <p className={summaryOpen ? '' : 'line-clamp-3'}>{item.summary}</p>
            {item.summary.length > 80 && (
              <button
                type="button"
                className="mt-0.5 font-medium text-[var(--kz-accent)] hover:underline"
                onClick={onToggleSummary}
              >
                {summaryOpen ? '收起' : '展开'}
              </button>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <CollectControl
            token={token}
            collectType={collectType}
            collectOptions={collectOptions}
            onCollectChange={onCollectChange}
            collectPending={collectPending}
          />
          {item?.alias && item.alias.length > 0 && (
            <span className="text-[11px] text-[var(--kz-fg-dim)]">
              别名 {item.alias.length} 个（可用于换关键词）
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
