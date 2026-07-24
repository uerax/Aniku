import { memo } from 'react'
import { Link } from 'react-router-dom'
import type { BangumiItem } from '@aniku/shared'
import { coverOf } from '@aniku/shared'

export const BangumiCard = memo(function BangumiCard({
  item,
}: {
  item: BangumiItem
}) {
  // Prefer larger cover when available — grid cells are wider now.
  const cover = coverOf(item, 'large') || coverOf(item, 'thumb')
  const title = item.nameCn || item.name
  const score =
    item.ratingScore > 0 ? item.ratingScore.toFixed(1) : null

  return (
    <Link
      to={`/subject/${item.id}`}
      className="bangumi-card group flex flex-col overflow-hidden rounded-2xl bg-transparent transition-transform duration-200 hover:-translate-y-1"
    >
      <div className="bangumi-card-cover relative aspect-[3/4] overflow-hidden rounded-2xl bg-[var(--kz-bg-soft)] shadow-[0_10px_28px_rgba(0,0,0,0.18)] ring-1 ring-[var(--kz-border)]">
        {cover ? (
          <img
            src={cover}
            alt=""
            loading="lazy"
            decoding="async"
            width={280}
            height={374}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[var(--kz-fg-dim)]">
            无封面
          </div>
        )}
        {/* bottom gradient for score legibility */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/75 to-transparent"
          aria-hidden
        />
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

export const BangumiGrid = memo(function BangumiGrid({
  items,
}: {
  items: BangumiItem[] | undefined | null
}) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) {
    return <EmptyState text="暂无数据" />
  }
  // Wider shell + fewer cols at mid breakpoints → larger posters (portal-style).
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 sm:gap-x-5 sm:gap-y-7 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
      {list.map((item) => (
        <BangumiCard key={item.id} item={item} />
      ))}
    </div>
  )
})

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--kz-border)] bg-[var(--kz-bg-elevated)]/40 py-16 text-center text-sm text-[var(--kz-fg-dim)]">
      {text}
    </div>
  )
}

export function LoadingState({ text = '加载中…' }: { text?: string }) {
  return (
    <div className="rounded-2xl border border-[var(--kz-border-subtle)] bg-[var(--kz-bg-elevated)]/50 py-16 text-center text-sm text-[var(--kz-fg-muted)]">
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
    <div className="rounded-2xl border border-red-900/40 bg-red-950/20 px-4 py-10 text-center">
      <div className="mx-auto max-w-xl text-left text-sm leading-relaxed whitespace-pre-wrap break-words text-red-300">
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
    <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight text-[var(--kz-fg)]">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 text-[15px] leading-snug text-[var(--kz-fg-muted)]">
            {description}
          </p>
        )}
      </div>
      {actions}
    </div>
  )
}
