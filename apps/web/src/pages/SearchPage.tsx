import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { bangumiApi } from '../lib/bangumi'
import { BangumiGrid, ErrorState, LoadingState, PageHeader } from '../components/ui'

export function SearchPage() {
  const [params] = useSearchParams()
  const keyword = (params.get('q') || '').trim()

  const q = useQuery({
    queryKey: ['search', keyword],
    queryFn: () => bangumiApi.search(keyword),
    enabled: keyword.length > 0,
  })

  return (
    <div>
      <PageHeader
        title={keyword ? `搜索「${keyword}」` : '搜索'}
        description="在 Bangumi 中搜索动画 · 使用右上角搜索框"
      />
      {!keyword && (
        <div className="rounded-xl border border-dashed border-zinc-800 py-16 text-center text-sm text-zinc-500">
          在右上角输入关键词后回车或点「搜索」
        </div>
      )}
      {keyword && q.isLoading && <LoadingState />}
      {keyword && q.isError && (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      )}
      {keyword && q.data && <BangumiGrid items={q.data.data} />}
    </div>
  )
}
