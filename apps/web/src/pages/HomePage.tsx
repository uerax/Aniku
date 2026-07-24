import { useQuery } from '@tanstack/react-query'
import { bangumiApi } from '../lib/bangumi'
import { BangumiGrid, ErrorState, LoadingState, PageHeader } from '../components/ui'
import { useHistoryStore } from '../stores/history'
import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { EMPTY_ARRAY } from '../lib/stable'

export function HomePage() {
  const trending = useQuery({
    queryKey: ['trending'],
    queryFn: () => bangumiApi.trending(28, 0),
    staleTime: 5 * 60_000,
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
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[20px] font-bold tracking-tight text-[var(--kz-fg)]">
              继续观看
            </h2>
            <Link
              to="/history"
              className="text-[15px] font-medium text-[var(--kz-accent)] hover:underline"
            >
              全部历史
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {recent.map((h) => (
              <Link
                key={h.id}
                to={`/play/${h.bangumiId}?plugin=${encodeURIComponent(h.pluginName)}&pageUrl=${encodeURIComponent(h.pageUrl)}&ep=${h.episode}&road=${h.road}&title=${encodeURIComponent(h.title)}${h.cover ? `&cover=${encodeURIComponent(h.cover)}` : ''}`}
                className="flex items-center gap-3 rounded-2xl border border-[var(--kz-border)] bg-[var(--kz-bg-elevated)] p-3 transition hover:bg-[var(--kz-bg-hover)]"
              >
                {h.cover ? (
                  <img
                    src={h.cover}
                    alt=""
                    className="h-16 w-12 rounded-lg object-cover shadow-md ring-1 ring-[var(--kz-border)]"
                  />
                ) : (
                  <div className="h-16 w-12 rounded-lg bg-[var(--kz-bg-soft)]" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-[var(--kz-fg)]">
                    {h.title}
                  </div>
                  <div className="mt-0.5 text-[13px] text-[var(--kz-fg-muted)]">
                    第 {h.episode} 集 · {h.pluginName}
                    {h.duration > 0 &&
                      ` · ${Math.floor((h.position / h.duration) * 100)}%`}
                  </div>
                  {h.duration > 0 && (
                    <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-[var(--kz-border)]">
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
          <h2 className="text-[20px] font-bold tracking-tight text-[var(--kz-fg)]">
            热门趋势
          </h2>
          <span className="text-[13px] text-[var(--kz-fg-muted)]">Bangumi</span>
        </div>
        {trending.isLoading && <LoadingState />}
        {trending.isError && (
          <ErrorState error={trending.error} onRetry={() => trending.refetch()} />
        )}
        {trending.data && <BangumiGrid items={trending.data?.data} />}
      </section>
    </div>
  )
}
