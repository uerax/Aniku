import { memo } from 'react'
import { Link } from 'react-router-dom'
import type { BangumiItem } from '@kazumi-web/shared'
import { coverOf } from '@kazumi-web/shared'

export const BangumiCard = memo(function BangumiCard({
  item,
}: {
  item: BangumiItem
}) {
  const cover = coverOf(item, 'thumb')
  const title = item.nameCn || item.name
  const score =
    item.ratingScore > 0 ? item.ratingScore.toFixed(1) : null

  return (
    <Link
      to={`/subject/${item.id}`}
      className="bangumi-card group flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60 hover:border-sky-700/60 hover:bg-zinc-900"
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-zinc-800">
        {cover ? (
          <img
            src={cover}
            alt=""
            loading="lazy"
            decoding="async"
            width={200}
            height={280}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-600 text-sm">
            无封面
          </div>
        )}
        {score && (
          <span className="absolute right-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-amber-300">
            {score}
          </span>
        )}
      </div>
      <div className="space-y-0.5 p-2.5">
        <div className="line-clamp-2 text-sm font-medium text-zinc-100 leading-snug">
          {title}
        </div>
        {item.nameCn && item.name && item.nameCn !== item.name && (
          <div className="truncate text-xs text-zinc-500">{item.name}</div>
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
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {list.map((item) => (
        <BangumiCard key={item.id} item={item} />
      ))}
    </div>
  )
})

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 py-16 text-center text-zinc-500">
      {text}
    </div>
  )
}

export function LoadingState({ text = '加载中…' }: { text?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 py-16 text-center text-zinc-400">
      {text}
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
    <div className="rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-10 text-center">
      <div className="mx-auto max-w-xl text-left text-sm leading-relaxed text-red-300 whitespace-pre-wrap break-words">
        {msg}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-lg bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700"
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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-zinc-400">{description}</p>
        )}
      </div>
      {actions}
    </div>
  )
}
