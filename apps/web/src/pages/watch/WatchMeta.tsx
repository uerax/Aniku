import { Link } from 'react-router-dom'
import {
  CollectType,
  CollectTypeLabel,
  coverOf,
  type BangumiItem,
} from '@aniku/shared'

/**
 * Same chrome + type scale as player 弹幕 status strip:
 *   flex … rounded-xl border … px-3 py-2 text-xs
 * font-normal is required on <button> so UA bold doesn't enlarge 简介.
 */
const META_BAR =
  'flex flex-wrap items-center gap-2 rounded-xl border border-[var(--kz-border)] bg-[var(--kz-bg-elevated)] px-3 py-2 text-xs font-normal leading-none text-[var(--kz-fg-muted)]'
/** 展开 / 收起 — same text-xs as bar body (no medium/semibold). */
const META_TOGGLE =
  'shrink-0 text-xs font-normal text-[var(--kz-accent)] hover:underline'

function MetaSubline({
  pluginName,
  episodeLabel,
  mediaHint,
  className = 'truncate text-xs text-[var(--kz-fg-muted)]',
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
  /* Mobile collapsed — pixel-match 弹幕 status bar type scale */
  if (compact && !metaOpen) {
    return (
      <div className="kz-watch-meta">
        <button
          type="button"
          onClick={onToggleMeta}
          className={`${META_BAR} w-full text-left transition hover:bg-[var(--kz-bg-hover)]`}
          aria-expanded={false}
        >
          <span className="shrink-0 text-xs font-normal text-[var(--kz-fg-muted)]">
            简介
          </span>
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

  /* Mobile expanded — same text-xs scale as 弹幕 / collapsed bar */
  if (compact) {
    return (
      <div className="kz-watch-meta space-y-2 rounded-xl border border-[var(--kz-border)] bg-[var(--kz-bg-elevated)] px-3 py-2 text-xs text-[var(--kz-fg-muted)]">
        <div className="flex items-start gap-2.5">
          {item && coverOf(item, 'large') ? (
            <div className="h-14 w-10 shrink-0 overflow-hidden rounded-lg border border-[var(--kz-border)] bg-[var(--kz-bg-soft)]">
              <img
                src={coverOf(item, 'large') || coverOf(item, 'thumb')}
                alt=""
                className="h-full w-full object-cover"
              />
            </div>
          ) : null}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-start gap-2">
              <h1 className="min-w-0 flex-1 text-xs font-semibold leading-snug text-[var(--kz-fg)]">
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

        {item && (
          <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs text-[var(--kz-fg-muted)]">
            {item.ratingScore > 0 && (
              <span className="font-medium text-amber-300/90">
                ★ {item.ratingScore.toFixed(1)}
              </span>
            )}
            {item.airDate && <span>{item.airDate}</span>}
            {item.tags?.slice(0, 5).map((t) => (
              <span key={t.name}>{t.name}</span>
            ))}
          </div>
        )}

        {item?.summary && (
          <div className="text-xs leading-relaxed text-[var(--kz-fg-muted)]">
            <p className={summaryOpen ? '' : 'line-clamp-2'}>{item.summary}</p>
            {item.summary.length > 60 && (
              <button
                type="button"
                className="mt-0.5 text-xs text-[var(--kz-accent)] hover:underline"
                onClick={onToggleSummary}
              >
                {summaryOpen ? '收起简介' : '展开简介'}
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {token ? (
            <select
              value={collectType}
              onChange={(e) =>
                onCollectChange(Number(e.target.value) as CollectType)
              }
              className="rounded-lg border border-[var(--kz-border)] bg-[var(--kz-bg)] px-2 py-0.5 text-xs"
              disabled={collectPending}
            >
              <option value={CollectType.none}>未收藏</option>
              {collectOptions.map((t) => (
                <option key={t} value={t}>
                  {CollectTypeLabel[t]}
                </option>
              ))}
            </select>
          ) : (
            <Link
              to="/settings"
              className="text-xs text-[var(--kz-fg-muted)] hover:text-[var(--kz-accent)]"
            >
              登录 Bangumi 同步追番
            </Link>
          )}
          {item?.alias && item.alias.length > 0 && (
            <span className="text-xs text-[var(--kz-fg-dim)]">
              别名 {item.alias.length} 个
            </span>
          )}
        </div>
      </div>
    )
  }

  /* Desktop — original full meta */
  return (
    <div className="kz-watch-meta flex gap-3 sm:gap-4">
      {item && coverOf(item, 'large') ? (
        <div className="h-[7.5rem] w-[5.5rem] shrink-0 overflow-hidden rounded-xl border border-[var(--kz-border)] bg-[var(--kz-bg-soft)] shadow-sm sm:h-36 sm:w-[6.75rem]">
          <img
            src={coverOf(item, 'large') || coverOf(item, 'thumb')}
            alt=""
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}
      <div className="min-w-0 flex-1 space-y-1.5">
        <h1 className="text-base font-semibold leading-snug text-[var(--kz-fg)] sm:text-lg">
          {title}
        </h1>
        {item?.nameCn && item.name && item.nameCn !== item.name && (
          <p className="text-xs text-[var(--kz-fg-muted)]">{item.name}</p>
        )}
        <MetaSubline
          pluginName={pluginName}
          episodeLabel={episodeLabel}
          mediaHint={mediaHint}
        />
        {item && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--kz-fg-muted)]">
            {item.ratingScore > 0 && (
              <span className="font-medium text-amber-300/90">
                ★ {item.ratingScore.toFixed(1)}
              </span>
            )}
            {item.airDate && <span>{item.airDate}</span>}
            {item.tags?.slice(0, 6).map((t) => (
              <span key={t.name}>{t.name}</span>
            ))}
          </div>
        )}
        {item?.summary && (
          <div className="text-xs leading-relaxed text-[var(--kz-fg-muted)]">
            <p className={summaryOpen ? '' : 'line-clamp-3'}>{item.summary}</p>
            {item.summary.length > 80 && (
              <button
                type="button"
                className="mt-0.5 text-[var(--kz-accent)] hover:underline"
                onClick={onToggleSummary}
              >
                {summaryOpen ? '收起' : '展开'}
              </button>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {token ? (
            <select
              value={collectType}
              onChange={(e) =>
                onCollectChange(Number(e.target.value) as CollectType)
              }
              className="rounded-lg border border-[var(--kz-border)] bg-[var(--kz-bg-elevated)] px-2 py-1 text-xs"
              disabled={collectPending}
            >
              <option value={CollectType.none}>未收藏</option>
              {collectOptions.map((t) => (
                <option key={t} value={t}>
                  {CollectTypeLabel[t]}
                </option>
              ))}
            </select>
          ) : (
            <Link
              to="/settings"
              className="text-xs text-[var(--kz-fg-muted)] hover:text-[var(--kz-accent)]"
            >
              登录 Bangumi 同步追番
            </Link>
          )}
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
