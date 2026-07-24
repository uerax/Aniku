import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  CollectType,
  toBangumiCollectionType,
  type BangumiItem,
} from '@aniku/shared'
import { bangumiApi } from '../lib/bangumi'
import { useSettingsStore } from '../stores/settings'
import {
  BangumiGrid,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from '../components/ui'
import { useMemo, useState } from 'react'

const TABS: { label: string; type?: CollectType }[] = [
  { label: '全部' },
  { label: '在看', type: CollectType.watching },
  { label: '想看', type: CollectType.planToWatch },
  { label: '看过', type: CollectType.watched },
  { label: '搁置', type: CollectType.onHold },
  { label: '抛弃', type: CollectType.abandoned },
]

export function CollectPage() {
  const token = useSettingsStore((s) => s.bangumiToken)
  const [tab, setTab] = useState(0)

  const me = useQuery({
    queryKey: ['me', token],
    queryFn: () => bangumiApi.me(),
    enabled: Boolean(token),
  })

  const bgmType = TABS[tab].type
    ? toBangumiCollectionType(TABS[tab].type!) ?? undefined
    : undefined

  const collections = useQuery({
    queryKey: ['collections', token, bgmType],
    queryFn: () =>
      bangumiApi.collections({
        limit: 50,
        type: bgmType,
      }),
    enabled: Boolean(token),
  })

  const items = useMemo(() => {
    const list: BangumiItem[] = []
    for (const c of collections.data?.data || []) {
      if (c.subject) list.push(c.subject)
    }
    return list
  }, [collections.data])

  if (!token) {
    return (
      <div>
        <PageHeader title="我的追番" />
        <EmptyState text="请先在设置中配置 Bangumi Access Token" />
        <div className="mt-4 text-center">
          <Link to="/settings" className="text-sky-400 hover:underline">
            前往设置
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="我的追番"
        description={
          me.data
            ? `${me.data.data.nickname || me.data.data.username} 的 Bangumi 收藏`
            : '同步自 Bangumi'
        }
      />
      {me.isError && (
        <div className="mb-4 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-sm text-amber-200">
          Token 校验失败：{(me.error as Error).message}
        </div>
      )}
      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t, i) => (
          <button
            key={t.label}
            type="button"
            onClick={() => setTab(i)}
            className={
              tab === i
                ? 'kz-pill kz-pill-active'
                : 'kz-pill kz-pill-idle border border-[var(--kz-border)]'
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      {collections.isLoading && <LoadingState />}
      {collections.isError && (
        <ErrorState error={collections.error} onRetry={() => collections.refetch()} />
      )}
      {collections.data && <BangumiGrid items={items} />}
    </div>
  )
}
