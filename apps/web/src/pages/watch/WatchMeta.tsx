import { Link } from 'react-router-dom'
import {
  CollectType,
  CollectTypeLabel,
  coverOf,
  type BangumiItem,
} from '@aniku/shared'

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
  /** Mobile top strip: slightly tighter cover */
  compact?: boolean
}) {
  return (
    <div className="kz-watch-meta flex gap-3 sm:gap-4">
      {item && coverOf(item, 'large') ? (
        <div
          className={
            compact
              ? 'h-[6.5rem] w-[4.75rem] shrink-0 overflow-hidden rounded-xl border border-[var(--kz-border)] bg-[var(--kz-bg-soft)] shadow-sm'
              : 'h-[7.5rem] w-[5.5rem] shrink-0 overflow-hidden rounded-xl border border-[var(--kz-border)] bg-[var(--kz-bg-soft)] shadow-sm sm:h-36 sm:w-[6.75rem]'
          }
        >
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
        <p className="text-xs text-[var(--kz-fg-muted)]">
          {pluginName || '未选源'}
          {episodeLabel ? (
            <>
              <span className="mx-1.5 text-[var(--kz-fg-dim)]">·</span>
              {episodeLabel}
            </>
          ) : null}
          {mediaHint ? (
            <>
              <span className="mx-1.5 text-[var(--kz-fg-dim)]">·</span>
              {mediaHint}
            </>
          ) : null}
        </p>
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
