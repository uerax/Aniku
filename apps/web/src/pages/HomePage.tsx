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
    queryFn: () => bangumiApi.trending(24, 0),
    staleTime: 5 * 60_000,
  })
  // Select stable array reference from store; slice in useMemo
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
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-medium">继续观看</h2>
            <Link to="/history" className="text-sm text-sky-400 hover:underline">
              全部历史
            </Link>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((h) => (
              <Link
                key={h.id}
                to={`/play/${h.bangumiId}?plugin=${encodeURIComponent(h.pluginName)}&pageUrl=${encodeURIComponent(h.pageUrl)}&ep=${h.episode}&road=${h.road}&title=${encodeURIComponent(h.title)}`}
                className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 hover:border-sky-800"
              >
                {h.cover ? (
                  <img src={h.cover} alt="" className="h-14 w-10 rounded object-cover" />
                ) : (
                  <div className="h-14 w-10 rounded bg-zinc-800" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{h.title}</div>
                  <div className="text-xs text-zinc-500">
                    第 {h.episode} 集 · {h.pluginName}
                    {h.duration > 0 &&
                      ` · ${Math.floor((h.position / h.duration) * 100)}%`}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-medium">热门趋势</h2>
        {trending.isLoading && <LoadingState />}
        {trending.isError && (
          <ErrorState error={trending.error} onRetry={() => trending.refetch()} />
        )}
        {trending.data && <BangumiGrid items={trending.data?.data} />}
      </section>
    </div>
  )
}
