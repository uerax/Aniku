import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { bangumiApi } from '../lib/bangumi'
import {
  BangumiGrid,
  ErrorState,
  LoadingState,
  PageHeader,
} from '../components/ui'
import clsx from 'clsx'

/** Popular genre tags on Bangumi (animation). */
const GENRE_TAGS = [
  '恋爱',
  '热血',
  '奇幻',
  '战斗',
  '校园',
  '日常',
  '治愈',
  '科幻',
  '悬疑',
  '搞笑',
  '异世界',
  '机战',
  '音乐',
  '运动',
  '偶像',
  '冒险',
  '百合',
  '后宫',
  '致郁',
  '催泪',
] as const

/** Standard anime broadcast seasons (1/4/7/10). */
const MONTH_OPTIONS = [1, 4, 7, 10] as const
type SeasonMonth = (typeof MONTH_OPTIONS)[number]

type SortKey = 'heat' | 'rank' | 'score' | 'date'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'heat', label: '热度' },
  { value: 'rank', label: '排名' },
  { value: 'score', label: '评分' },
  { value: 'date', label: '放送时间' },
]

const PAGE_SIZE = 24

function currentYear() {
  return new Date().getFullYear()
}

/** Current broadcast season start month: 1 / 4 / 7 / 10. */
function currentSeasonMonth(): SeasonMonth {
  const m = new Date().getMonth() + 1 // 1–12
  if (m <= 3) return 1
  if (m <= 6) return 4
  if (m <= 9) return 7
  return 10
}

/** Recent years first (current year), then older years down to 1980. */
function buildYearOptions(): number[] {
  const y = currentYear()
  const years: number[] = []
  for (let i = y; i >= 1980; i--) years.push(i)
  return years
}

function parseSort(raw: string | null): SortKey {
  if (raw === 'rank' || raw === 'score' || raw === 'date' || raw === 'heat') {
    return raw
  }
  return 'heat'
}

function parseYear(raw: string | null): number | null {
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  const y = Math.trunc(n)
  if (y < 1900 || y > 2100) return null
  return y
}

function parseMonth(raw: string | null): SeasonMonth | null {
  if (!raw) return null
  const n = Number(raw)
  if (n === 1 || n === 4 || n === 7 || n === 10) return n
  return null
}

/**
 * Continuous air_date range for a broadcast season.
 * 1 → Jan–Mar, 4 → Apr–Jun, 7 → Jul–Sep, 10 → Oct–Dec (no gaps for mid-season OVA).
 */
function seasonAirDate(year: number, month: SeasonMonth): string[] {
  switch (month) {
    case 1:
      return [`>=${year}-01-01`, `<${year}-04-01`]
    case 4:
      return [`>=${year}-04-01`, `<${year}-07-01`]
    case 7:
      return [`>=${year}-07-01`, `<${year}-10-01`]
    case 10:
      return [`>=${year}-10-01`, `<${year + 1}-01-01`]
  }
}

export function AnimePage() {
  const [params, setParams] = useSearchParams()
  const tag = (params.get('tag') || '').trim()
  const yearQuery = params.get('year')
  /** Explicit 全部 years — `year=all` in URL. */
  const yearAll = yearQuery === 'all'
  /**
   * Selected year for chips + filter.
   * Default (no `year` param): current calendar year.
   * `year=all`: no year filter (null).
   */
  const year = yearAll
    ? null
    : (parseYear(yearQuery) ?? currentYear())
  const monthQuery = params.get('month')
  /** Explicit 全部 months — `month=all` in URL. */
  const monthAll = monthQuery === 'all'
  /**
   * Selected season month for chips + filter.
   * Default (no `month` param): current broadcast quarter (1/4/7/10).
   * `month=all`: no season filter (null).
   */
  const month = monthAll
    ? null
    : (parseMonth(monthQuery) ?? currentSeasonMonth())
  const sort = parseSort(params.get('sort'))
  const page = Math.max(1, Number(params.get('page') || '1') || 1)
  const offset = (page - 1) * PAGE_SIZE

  // Season filter always needs a concrete year (default current when year=all).
  const seasonYear = year ?? currentYear()

  const yearOptions = useMemo(() => buildYearOptions(), [])

  const patchParams = useCallback(
    (patch: Record<string, string | null>, opts?: { resetPage?: boolean }) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(patch)) {
            if (v == null || v === '') next.delete(k)
            else next.set(k, v)
          }
          if (opts?.resetPage !== false) {
            // Filter/sort changes reset to page 1 unless patch explicitly sets page
            if (!('page' in patch)) next.delete('page')
          }
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const searchOpts = useMemo(() => {
    const opts: {
      limit: number
      offset: number
      sort: SortKey
      tags?: string[]
      year?: number
      airDate?: string[]
    } = {
      limit: PAGE_SIZE,
      offset,
      sort,
      tags: tag ? [tag] : undefined,
    }
    if (month != null) {
      // Explicit quarter range; do not also pass year (server prefers airDate)
      opts.airDate = seasonAirDate(seasonYear, month)
    } else if (year != null) {
      opts.year = year
    }
    return opts
  }, [tag, month, year, seasonYear, sort, offset])

  const q = useQuery({
    queryKey: [
      'anime-browse',
      tag,
      yearAll ? 'all' : year,
      monthAll ? 'all' : month,
      sort,
      page,
    ],
    queryFn: () => bangumiApi.search('', searchOpts),
    staleTime: 3 * 60_000,
    placeholderData: (prev) => prev,
  })

  const total = q.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const items = q.data?.data

  const descParts: string[] = ['Bangumi 动画浏览']
  if (tag) descParts.push(`类型 · ${tag}`)
  if (month != null) {
    descParts.push(`${seasonYear} 年 ${month} 月季`)
  } else if (year != null) {
    descParts.push(`${year} 年`)
  }
  const sortLabel = SORT_OPTIONS.find((s) => s.value === sort)?.label
  if (sortLabel) descParts.push(`按${sortLabel}`)
  if (total > 0) descParts.push(`共 ${total} 部`)

  return (
    <div>
      <PageHeader title="番剧" description={descParts.join(' · ')} />

      {/* Genre tags */}
      <section className="mb-4">
        <div className="mb-2 text-[13px] font-medium text-[var(--kz-fg-muted)]">
          类型
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip
            active={!tag}
            onClick={() => patchParams({ tag: null })}
            label="全部"
          />
          {GENRE_TAGS.map((g) => (
            <FilterChip
              key={g}
              active={tag === g}
              onClick={() =>
                patchParams({ tag: tag === g ? null : g })
              }
              label={g}
            />
          ))}
        </div>
      </section>

      {/* Year */}
      <section className="mb-4">
        <div className="mb-2 text-[13px] font-medium text-[var(--kz-fg-muted)]">
          年份
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip
            active={yearAll}
            onClick={() => patchParams({ year: 'all', month: 'all' })}
            label="全部"
          />
          {yearOptions.slice(0, 12).map((y) => (
            <FilterChip
              key={y}
              active={!yearAll && year === y}
              onClick={() => patchParams({ year: String(y) })}
              label={String(y)}
            />
          ))}
          <label className="inline-flex items-center gap-1.5">
            <span className="sr-only">更多年份</span>
            <select
              value={
                !yearAll &&
                year != null &&
                !yearOptions.slice(0, 12).includes(year)
                  ? String(year)
                  : ''
              }
              onChange={(e) => {
                const v = e.target.value
                if (!v) return
                patchParams({ year: v })
              }}
              className="box-border h-9 min-w-[4.5rem] rounded-full border border-[var(--kz-border)] bg-[var(--kz-bg-elevated)] px-3 text-center text-[13px] font-bold leading-none text-[var(--kz-fg)] outline-none focus:border-[var(--kz-accent)]"
            >
              <option value="">更早…</option>
              {yearOptions.slice(12).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* Month season + sort */}
      <section className="mb-5 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-2 text-[13px] font-medium text-[var(--kz-fg-muted)]">
            月份
          </div>
          <div className="flex flex-wrap gap-2">
            <FilterChip
              active={monthAll}
              onClick={() => patchParams({ month: 'all' })}
              label="全部"
            />
            {MONTH_OPTIONS.map((m) => (
              <FilterChip
                key={m}
                active={!monthAll && month === m}
                onClick={() => {
                  // Keep explicit year in URL (default current year when year=all)
                  patchParams({
                    month: String(m),
                    year: yearAll ? String(currentYear()) : String(seasonYear),
                  })
                }}
                label={`${m}月`}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-[13px] font-medium text-[var(--kz-fg-muted)]">
            排序
          </div>
          <div className="flex flex-wrap gap-2">
            {SORT_OPTIONS.map((s) => (
              <FilterChip
                key={s.value}
                active={sort === s.value}
                onClick={() => patchParams({ sort: s.value })}
                label={s.label}
              />
            ))}
          </div>
        </div>
      </section>

      {q.isLoading && !q.data && <LoadingState />}
      {q.isError && (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      )}
      {q.data && (
        <>
          <div className={clsx(q.isFetching && 'opacity-70 transition-opacity')}>
            <BangumiGrid items={items} />
          </div>

          {totalPages > 1 && (
            <nav
              className="mt-8 flex flex-wrap items-center justify-center gap-2"
              aria-label="分页"
            >
              <button
                type="button"
                disabled={page <= 1}
                onClick={() =>
                  patchParams(
                    { page: page <= 2 ? null : String(page - 1) },
                    { resetPage: false },
                  )
                }
                className="kz-pill kz-pill-idle border border-[var(--kz-border)] disabled:opacity-40"
              >
                上一页
              </button>
              <span className="px-2 text-[13px] tabular-nums text-[var(--kz-fg-muted)]">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() =>
                  patchParams({ page: String(page + 1) }, { resetPage: false })
                }
                className="kz-pill kz-pill-idle border border-[var(--kz-border)] disabled:opacity-40"
              >
                下一页
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Always reserve 1px border so active/idle sizes match; center text.
      className={clsx(
        'kz-pill min-w-[3.5rem] border',
        active
          ? 'kz-pill-active border-transparent'
          : 'kz-pill-idle border-[var(--kz-border)]',
      )}
    >
      {label}
    </button>
  )
}
