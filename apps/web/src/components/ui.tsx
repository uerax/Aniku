import { memo } from 'react'
import { Link } from 'react-router-dom'
import type { BangumiItem } from '@animaku/shared'
import {
  airProgressLabel,
  coverOf,
  estimateAirProgress,
} from '@animaku/shared'
import { preloadVideoPlayer } from '../player/lazy'

/** Chip text color on dark cover — pairs with warm score yellow on the right. */
function airChipClass(
  status: ReturnType<typeof estimateAirProgress>['status'],
): string {
  switch (status) {
    case 'finished':
      // Soft mint — “done”, less shouty than pure success green
      return 'text-[var(--kz-air-finished)]'
    case 'airing':
      // Cool sky — active update, complementary to score
      return 'text-[var(--kz-air-airing)]'
    case 'upcoming':
      return 'text-[var(--kz-air-upcoming)]'
    default:
      return 'text-[var(--kz-air-airing)]'
  }
}

/** First-screen grid: eager; index 0 may use high fetch priority (LCP). */
export type CoverImagePriority = 'lazy' | 'eager' | 'high'

export const BangumiCard = memo(function BangumiCard({
  item,
  imagePriority = 'lazy',
}: {
  item: BangumiItem
  imagePriority?: CoverImagePriority
}) {
  // List/grid: prefer common/medium (thumb). large decode cost janks scroll
  // when many cards enter the viewport at once.
  const cover = coverOf(item, 'thumb')
  const title = item.nameCn || item.name
  const score =
    item.ratingScore > 0 ? item.ratingScore.toFixed(1) : null
  // Derived at render from cached airDate/eps (not frozen inside list TTL).
  const air = estimateAirProgress(item)
  const airLabel = airProgressLabel(item)
  const eager = imagePriority !== 'lazy'

  return (
    <Link
      to={`/subject/${item.id}`}
      // Warm player chunk on intent — import only, no Hls/danmaku init
      onMouseEnter={preloadVideoPlayer}
      onFocus={preloadVideoPlayer}
      className="bangumi-card group flex flex-col overflow-hidden rounded-2xl bg-transparent transition-transform duration-200 hover:-translate-y-1"
    >
      <div className="bangumi-card-cover relative aspect-[3/4] overflow-hidden rounded-2xl bg-[var(--kz-bg-soft)] shadow-[0_10px_28px_rgba(0,0,0,0.18)] ring-1 ring-[var(--kz-border)]">
        {cover ? (
          <img
            src={cover}
            alt=""
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            // React 19 / browsers: hint LCP candidate on the first above-fold card
            fetchPriority={
              imagePriority === 'high'
                ? 'high'
                : imagePriority === 'eager'
                  ? 'auto'
                  : 'low'
            }
            // Intrinsic hint for aspect ratio before CSS; common covers ~200px wide
            width={200}
            height={267}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[var(--kz-fg-dim)]">
            无封面
          </div>
        )}
        {/* bottom gradient for score / air-progress legibility */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/75 to-transparent"
          aria-hidden
        />
        {airLabel && (
          <span
            className={`absolute bottom-2.5 left-2.5 max-w-[70%] truncate rounded-md bg-black/65 px-1.5 py-0.5 text-xs font-semibold tabular-nums backdrop-blur-sm ${airChipClass(air.status)}`}
          >
            {airLabel}
          </span>
        )}
        {score && (
          <span className="absolute bottom-2.5 right-2.5 rounded-md bg-black/65 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-[var(--kz-score)] backdrop-blur-sm">
            {score}
          </span>
        )}
      </div>
      <div className="space-y-0.5 px-0.5 pb-1 pt-3">
        <div className="line-clamp-2 text-[15px] font-medium leading-snug text-[var(--kz-fg)] group-hover:text-[var(--kz-accent)]">
          {title}
        </div>
        {item.nameCn && item.name && item.nameCn !== item.name && (
          <div className="truncate text-[13px] text-[var(--kz-fg-muted)]">
            {item.name}
          </div>
        )}
      </div>
    </Link>
  )
})

/** Above-fold cards on common phone/desktop grids (~2–6 cols × 2 rows). */
const DEFAULT_EAGER_COVERS = 12

/** Same track as live grid — skeleton must match or CLS returns. */
const BANGUMI_GRID_CLASS =
  'grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 sm:gap-x-5 sm:gap-y-7 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7'

export const BangumiGrid = memo(function BangumiGrid({
  items,
  /** How many leading covers load eagerly (rest stay lazy). */
  eagerCount = DEFAULT_EAGER_COVERS,
}: {
  items: BangumiItem[] | undefined | null
  eagerCount?: number
}) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) {
    return <EmptyState text="暂无数据" />
  }
  // Wider shell + fewer cols at mid breakpoints → larger posters (portal-style).
  return (
    <div className={BANGUMI_GRID_CLASS}>
      {list.map((item, index) => {
        let imagePriority: CoverImagePriority = 'lazy'
        if (index < eagerCount) {
          // First card is the strongest LCP candidate on home / browse.
          imagePriority = index === 0 ? 'high' : 'eager'
        }
        return (
          <BangumiCard
            key={item.id}
            item={item}
            imagePriority={imagePriority}
          />
        )
      })}
    </div>
  )
})

/**
 * CLS stand-in for BangumiGrid while list queries load.
 * Matches column gutters + 3:4 cover + title block height of BangumiCard.
 */
export function BangumiGridSkeleton({
  count = DEFAULT_EAGER_COVERS,
}: {
  count?: number
}) {
  const n = Math.max(1, Math.min(count, 28))
  return (
    <div
      className={BANGUMI_GRID_CLASS}
      aria-busy="true"
      aria-label="加载中"
    >
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex flex-col overflow-hidden rounded-2xl">
          <div className="kz-skeleton aspect-[3/4] rounded-2xl ring-1 ring-[var(--kz-border)]" />
          <div className="space-y-2 px-0.5 pb-1 pt-3">
            <div className="kz-skeleton h-4 w-[88%] rounded-md" />
            <div className="kz-skeleton h-3 w-[55%] rounded-md" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="kz-surface border-dashed px-4 py-16 text-center text-sm text-[var(--kz-fg-dim)] shadow-none">
      {text}
    </div>
  )
}

/** Compact spinner — prefer BangumiGridSkeleton on list routes (CLS). */
export function LoadingState({ text = '加载中…' }: { text?: string }) {
  return (
    <div className="kz-surface px-4 py-16 text-center text-sm text-[var(--kz-fg-muted)]">
      <span className="inline-flex items-center gap-2">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--kz-border)] border-t-[var(--kz-accent)]" />
        {text}
      </span>
    </div>
  )
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown
  onRetry?: () => void
}) {
  const msg = error instanceof Error ? error.message : '出错了'
  return (
    <div className="kz-surface kz-surface-danger px-4 py-10 text-center">
      <div className="mx-auto max-w-xl text-left text-sm leading-relaxed break-words whitespace-pre-wrap text-[var(--kz-danger)]">
        {msg}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="kz-btn-primary mt-4"
        >
          重试
        </button>
      )}
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0 max-w-3xl">
        <h1 className="text-[1.95rem] font-bold leading-[1.15] tracking-[-0.035em] text-[var(--kz-fg)] sm:text-[2.15rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-[var(--kz-fg-muted)]">
            {description}
          </p>
        )}
      </div>
      {actions}
    </div>
  )
}
