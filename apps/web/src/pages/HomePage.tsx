import { useQuery } from '@tanstack/react-query'
import { bangumiApi } from '../lib/bangumi'
import {
  BangumiGrid,
  BangumiGridSkeleton,
  ErrorState,
  PageHeader,
} from '../components/ui'
import { useHistoryStore } from '../stores/history'
import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { EMPTY_ARRAY } from '../lib/stable'

export function HomePage() {
  const trending = useQuery({
    queryKey: ['trending'],
    queryFn: ({ signal }) => bangumiApi.trending(28, 0, { signal }),
    // Align with server bangumi trending TTL (12h); keep client shorter to revalidate via /api HIT
    staleTime: 2 * 60 * 60_000,
    gcTime: 12 * 60 * 60_000,
  })
  const items = useHistoryStore((s) =>
    Array.isArray(s.items) ? s.items : EMPTY_ARRAY,
  )
  const recent = useMemo(() => items.slice(0, 6), [items])

  return (
    <div className="space-y-10">
      <PageHeader
        title="发现"
        description="来自 Bangumi 的动画趋势，点击进入详情与选源播放"
      />

      {recent.length > 0 && (
        <section>
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="kz-section-title">继续观看</h2>
            <Link
              to="/history"
              className="text-[13px] font-medium text-[var(--kz-accent)] hover:underline"
            >
              全部历史
            </Link>
          </div>
          {/*
            min-w-0 on grid + items: iOS Safari keeps min-width:auto on grid
            children, so horizontal resume cards (long plugin names) can grow
            wider than the page shell / Bangumi grid.
          */}
          <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {recent.map((h) => (
              <Link
                key={h.id}
                to={`/play/${h.bangumiId}?plugin=${encodeURIComponent(h.pluginName)}&pageUrl=${encodeURIComponent(h.pageUrl)}&ep=${h.episode}&road=${h.road}&title=${encodeURIComponent(h.title)}${h.cover ? `&cover=${encodeURIComponent(h.cover)}` : ''}${h.sourceUrl ? `&source=${encodeURIComponent(h.sourceUrl)}` : ''}`}
                className="kz-surface kz-surface-interactive flex min-w-0 max-w-full items-center gap-3 overflow-hidden p-3"
              >
                {h.cover ? (
                  <img
                    src={h.cover}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width={48}
                    height={64}
                    className="h-16 w-12 shrink-0 rounded-lg object-cover shadow-md ring-1 ring-[var(--kz-border)]"
                  />
                ) : (
                  <div className="h-16 w-12 shrink-0 rounded-lg bg-[var(--kz-bg-soft)]" />
                )}
                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="truncate text-[13px] font-semibold text-[var(--kz-fg)]">
                    {h.title}
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-[var(--kz-fg-muted)]">
                    第 {h.episode} 集 · {h.pluginName}
                    {h.duration > 0 &&
                      ` · ${Math.floor((h.position / h.duration) * 100)}%`}
                  </div>
                  {h.duration > 0 && (
                    <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-[var(--kz-border)]">
                      <div
                        className="h-full rounded-full bg-[var(--kz-accent)]"
                        style={{
                          width: `${Math.min(100, Math.round((h.position / h.duration) * 100))}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-4 flex items-end justify-between gap-2">
          <h2 className="kz-section-title">热门趋势</h2>
          <span className="kz-section-meta">BANGUMI</span>
        </div>
        {trending.isLoading && <BangumiGridSkeleton count={12} />}
        {trending.isError && (
          <ErrorState error={trending.error} onRetry={() => trending.refetch()} />
        )}
        {trending.data && <BangumiGrid items={trending.data?.data} />}
      </section>
    </div>
  )
}
