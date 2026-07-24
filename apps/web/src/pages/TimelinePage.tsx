import { useMemo, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { bangumiApi } from '../lib/bangumi'
import {
  BangumiGrid,
  ErrorState,
  LoadingState,
  PageHeader,
} from '../components/ui'
import { EMPTY_ARRAY } from '../lib/stable'

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

export function TimelinePage() {
  const today = new Date().getDay() // 0 Sun
  const defaultDay = today === 0 ? 6 : today - 1
  const [day, setDay] = useState(defaultDay)

  const q = useQuery({
    queryKey: ['calendar'],
    queryFn: () => bangumiApi.calendar(),
    staleTime: 5 * 60_000,
  })

  const days = q.data?.data
  const items = useMemo(() => {
    if (!days || !Array.isArray(days[day])) return EMPTY_ARRAY
    return days[day]
  }, [days, day])

  const onSelectDay = useCallback((i: number) => {
    setDay(i)
  }, [])

  return (
    <div>
      <PageHeader
        title="放送时间表"
        description={`本季每日放送（Bangumi）${items.length ? ` · 当日 ${items.length} 部` : ''}`}
      />
      <div className="mb-5 flex flex-wrap gap-2">
        {WEEKDAYS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => onSelectDay(i)}
            className={
              day === i
                ? 'kz-pill kz-pill-active'
                : 'kz-pill kz-pill-idle border border-[var(--kz-border)]'
            }
          >
            {label}
            {i === defaultDay ? ' · 今' : ''}
            {days?.[i]?.length ? (
              <span className="ml-1 opacity-70">({days[i].length})</span>
            ) : null}
          </button>
        ))}
      </div>
      {q.isLoading && <LoadingState />}
      {q.isError && (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      )}
      {q.data && <BangumiGrid items={items} />}
    </div>
  )
}
