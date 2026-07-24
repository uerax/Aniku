import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  CollectType,
  CollectTypeLabel,
  coverOf,
} from '@aniku/shared'
import {
  useWatchSession,
  bestTitleSimilarity,
} from '../lib/use-watch-session'
import { bangumiApi } from '../lib/bangumi'
import { useSettingsStore } from '../stores/settings'
import { ErrorState, LoadingState } from '../components/ui'
import {
  EmbedPlayerSuspense,
  VideoPlayerSuspense,
} from '../player/lazy'

/**
 * Unified subject + cinema page (Bilibili-style).
 * Used for both /subject/:id and /play/:id — no separate pages.
 * Plugins stay idle until clicked; sources & episodes panels collapse.
 */
export function WatchPage() {
  const { id } = useParams()
  const bangumiId = Number(id)
  const w = useWatchSession(Number.isFinite(bangumiId) ? bangumiId : 0)

  const token = useSettingsStore((s) => s.bangumiToken)
  const qc = useQueryClient()
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [metaOpen, setMetaOpen] = useState(false)
  /** Sources panel open by default so user can pick a rule */
  const [sourcesOpen, setSourcesOpen] = useState(true)
  /** Episodes open when we have a selection / resume */
  const [epsOpen, setEpsOpen] = useState(true)

  const [kwInput, setKwInput] = useState('')

  const collection = useQuery({
    queryKey: ['collection', bangumiId, token],
    queryFn: () => bangumiApi.getCollection(bangumiId),
    enabled: Number.isFinite(bangumiId) && Boolean(token),
  })
  const setCollect = useMutation({
    mutationFn: (type: CollectType) =>
      bangumiApi.setCollection(bangumiId, type),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collection', bangumiId] })
      qc.invalidateQueries({ queryKey: ['collections'] })
    },
  })
  const collectType = collection.data?.data?.type ?? CollectType.none
  const collectOptions = useMemo(
    () =>
      [
        CollectType.watching,
        CollectType.planToWatch,
        CollectType.watched,
        CollectType.onHold,
        CollectType.abandoned,
      ] as CollectType[],
    [],
  )

  const keywordOptions = useMemo(() => {
    const pluginName =
      w.keywordTargetPlugin?.name || w.selection?.plugin.name || ''
    const manual = pluginName ? w.sessionKeywords[pluginName] || [] : []
    const seen = new Set<string>()
    const out: string[] = []
    for (const k of [...w.keywordCandidates, ...manual]) {
      const t = k.trim()
      if (!t || seen.has(t)) continue
      seen.add(t)
      out.push(t)
    }
    return out
  }, [
    w.keywordCandidates,
    w.sessionKeywords,
    w.keywordTargetPlugin,
    w.selection,
  ])

  const activeRoadIndex = Math.min(
    w.visibleRoad,
    Math.max(0, (w.selection?.roads.length || 1) - 1),
  )
  const activeRoad = w.selection?.roads[activeRoadIndex]
  const epCount = activeRoad?.identifier?.length ?? 0

  // Auto-expand episodes when chapters arrive; keep sources open
  useEffect(() => {
    if (w.selection?.roads?.length) setEpsOpen(true)
  }, [w.selection])

  // On resume with media, collapse sources to give player room (user can re-open)
  useEffect(() => {
    if (w.mediaSrc && w.episode) {
      setSourcesOpen(false)
      setEpsOpen(true)
    }
  }, [w.mediaSrc, w.episode?.pageUrl])

  function onKeywordSubmit(e: FormEvent) {
    e.preventDefault()
    const kw = kwInput.trim()
    if (!kw) return
    void w.reSearchCurrentSource(kw)
  }

  if (!Number.isFinite(bangumiId) || bangumiId <= 0) {
    return <ErrorState error={new Error('无效的番剧 ID')} />
  }

  if (w.subjectLoading && !w.title) {
    return <LoadingState text="加载条目…" />
  }

  const hasKeywordTarget = Boolean(
    w.keywordTargetPlugin || w.selection?.plugin,
  )
  const item = w.bangumiItem

  return (
    <div className="kz-watch -mx-4 -mt-2 space-y-3 sm:mx-0 sm:mt-0">
      {/* Compact title + meta toggle */}
      <div className="flex items-start gap-3 px-4 sm:px-0">
        {item && coverOf(item, 'thumb') ? (
          <button
            type="button"
            onClick={() => setMetaOpen((v) => !v)}
            className="h-14 w-10 shrink-0 overflow-hidden rounded-lg border border-[var(--kz-border)] bg-[var(--kz-bg-soft)] shadow-md ring-1 ring-[var(--kz-border)] sm:h-16 sm:w-12"
            title="展开/收起简介"
          >
            <img
              src={coverOf(item, 'thumb')}
              alt=""
              className="h-full w-full object-cover"
            />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 truncate text-base font-semibold text-[var(--kz-fg)] sm:text-lg">
              {w.title}
            </h1>
            <button
              type="button"
              onClick={() => setMetaOpen((v) => !v)}
              className="shrink-0 text-[11px] text-[var(--kz-fg-muted)] hover:text-[var(--kz-accent)]"
            >
              {metaOpen ? '收起信息' : '简介'}
            </button>
          </div>
          <p className="truncate text-xs text-[var(--kz-fg-muted)]">
            {w.pluginName || '未选源'}
            {w.episode ? (
              <>
                <span className="mx-1.5 text-[var(--kz-fg-dim)]">·</span>
                第 {w.episode.episode} 集
              </>
            ) : null}
            {w.mediaSrc ? (
              <>
                <span className="mx-1.5 text-[var(--kz-fg-dim)]">·</span>
                {w.playbackMode === 'proxy' ? '经服务器代理' : '直连源站'}
              </>
            ) : null}
          </p>
        </div>
      </div>

      {metaOpen && item && (
        <div className="mx-4 space-y-2 rounded-xl border border-[var(--kz-border)] bg-[var(--kz-bg-elevated)] p-3 text-sm sm:mx-0">
          {item.nameCn && item.name && item.nameCn !== item.name && (
            <p className="text-xs text-[var(--kz-fg-muted)]">{item.name}</p>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--kz-fg-muted)]">
            {item.ratingScore > 0 && (
              <span className="text-amber-300/90">
                ★ {item.ratingScore.toFixed(1)}
              </span>
            )}
            {item.airDate && <span>{item.airDate}</span>}
            {item.tags?.slice(0, 6).map((t) => (
              <span key={t.name}>{t.name}</span>
            ))}
          </div>
          {item.summary && (
            <div className="text-xs leading-relaxed text-[var(--kz-fg-muted)]">
              <p className={summaryOpen ? '' : 'line-clamp-3'}>{item.summary}</p>
              {item.summary.length > 80 && (
                <button
                  type="button"
                  className="mt-0.5 text-[var(--kz-accent)] hover:underline"
                  onClick={() => setSummaryOpen((v) => !v)}
                >
                  {summaryOpen ? '收起' : '展开'}
                </button>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {token ? (
              <select
                value={collectType}
                onChange={(e) =>
                  setCollect.mutate(Number(e.target.value) as CollectType)
                }
                className="rounded-lg border border-[var(--kz-border)] bg-[var(--kz-bg-elevated)] px-2 py-1 text-xs"
                disabled={setCollect.isPending}
              >
                <option value={CollectType.none}>未收藏</option>
                {collectOptions.map((t) => (
                  <option key={t} value={t}>
                    {CollectTypeLabel[t]}
                  </option>
                ))}
              </select>
            ) : (
              <Link
                to="/settings"
                className="text-xs text-[var(--kz-fg-muted)] hover:text-[var(--kz-accent)]"
              >
                登录 Bangumi 同步追番
              </Link>
            )}
            {item.alias && item.alias.length > 0 && (
              <span className="text-[11px] text-[var(--kz-fg-dim)]">
                别名 {item.alias.length} 个（可用于换关键词）
              </span>
            )}
          </div>
        </div>
      )}

      {/* Player + right rail */}
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-4">
        <div className="min-w-0">
          {/* Same max-width as 16:9 player so under-player chrome lines up */}
          <div className="kz-player-stack space-y-2 px-4 sm:px-0">
            {w.resolveLoading && !w.mediaSrc && (
              <div className="kz-player-placeholder text-sm text-[var(--kz-fg-muted)]">
                <div className="flex flex-col items-center gap-2">
                  <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[var(--kz-border)] border-t-[var(--kz-accent)]" />
                  解析播放地址…
                </div>
              </div>
            )}

            {w.mediaSrc && (
              <VideoPlayerSuspense
                key={w.playerKey}
                src={w.mediaSrc}
                initialTime={w.resumeTime}
                comments={w.dm.visibleComments}
                danmaku={w.danmakuSettings}
                player={w.playerSettings}
                onPlayerChange={w.setPlayer}
                onProgress={w.onProgress}
                onToggleDanmaku={() =>
                  w.setDanmaku({ enabled: !w.danmakuSettings.enabled })
                }
                onDanmakuChange={w.setDanmaku}
                onPrev={() => w.goAdjacentEpisode(-1)}
                onNext={() => w.goAdjacentEpisode(1)}
                onMediaAuthExpired={w.onMediaAuthExpired}
                onMediaLoadFailed={w.onMediaLoadFailed}
                danmakuPanel={w.dm.panel}
              />
            )}

            {w.selection &&
              w.episode &&
              Boolean(w.resolveError) &&
              !w.mediaSrc &&
              !w.resolveLoading && (
                <EmbedPlayerSuspense
                  pageUrl={w.pageUrl}
                  title={w.title}
                  reason={
                    w.resolveError instanceof Error
                      ? w.resolveError.message
                      : '静态解析失败'
                  }
                  onRetryResolve={w.refetchResolve}
                />
              )}

            {!w.mediaSrc && !w.resolveLoading && !w.resolveError && (
              <div className="kz-player-placeholder flex-col gap-1.5 text-sm text-[var(--kz-fg-muted)]">
                <span>
                  {w.roadLoading
                    ? `正在加载 ${w.defaultSourceName} 分集…`
                    : w.selection
                      ? '在右侧选集区点集数即可播放'
                      : `已默认搜索 ${w.defaultSourceName}，请稍候或点右侧结果`}
                </span>
                <span className="text-xs text-[var(--kz-fg-dim)]">
                  默认会选中第一条搜索结果并加载分集；其它源需手动点搜
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--kz-border)] bg-[var(--kz-bg-elevated)] px-3 py-2 text-xs text-[var(--kz-fg-muted)]">
              <span className="text-[var(--kz-fg-muted)]">弹幕</span>
              <span className="min-w-0 flex-1 truncate text-[var(--kz-fg)]">
                {w.dm.statusLine || '未加载'}
              </span>
              {w.dm.chips.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={!c.loaded}
                  onClick={() => w.dm.toggleSource(c.id)}
                  className={clsx(
                    'rounded-full px-2 py-0.5 text-[11px]',
                    !c.loaded && 'opacity-40',
                    c.loaded && c.enabled
                      ? 'bg-[var(--kz-accent)] text-white'
                      : 'bg-[var(--kz-bg-soft)] text-[var(--kz-fg-muted)]',
                  )}
                >
                  {c.label}
                  {c.loaded ? ` ${c.count}` : ''}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT rail — two separate panels (sources / episodes) */}
        <aside className="mx-4 flex flex-col gap-3 sm:mx-0 lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100dvh-5.5rem)] lg:overflow-y-auto">
          {/* —— 视频源 —— */}
          <section className="overflow-hidden rounded-2xl border border-[var(--kz-border)] bg-[var(--kz-bg-elevated)]">
            <button
              type="button"
              onClick={() => setSourcesOpen((v) => !v)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[var(--kz-bg-hover)]"
            >
              <span
                className={clsx(
                  'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] text-[var(--kz-fg-muted)] transition-transform',
                  sourcesOpen && 'rotate-90 text-[var(--kz-accent)]',
                )}
                aria-hidden
              >
                ▸
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold tracking-tight text-[var(--kz-fg)]">
                  视频源
                </span>
                <span className="mt-0.5 block text-[12px] text-[var(--kz-fg-muted)]">
                  默认 {w.defaultSourceName}
                  {w.searchResults.length
                    ? ` · ${w.searchResults.filter((r) => r.searched).length}/${w.searchResults.length} 已搜索`
                    : ''}
                </span>
              </span>
            </button>

            {sourcesOpen && (
              <div className="border-t border-[var(--kz-border)]">
                <div className="space-y-2 px-4 py-3">
                  <form onSubmit={onKeywordSubmit} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="relative w-4/5 min-w-0 shrink">
                        <select
                          value={
                            keywordOptions.includes(w.searchKeyword)
                              ? w.searchKeyword
                              : ''
                          }
                          disabled={!hasKeywordTarget}
                          onChange={(e) => {
                            const v = e.target.value
                            if (!v) return
                            setKwInput(v)
                            void w.reSearchCurrentSource(v)
                          }}
                          className="w-full appearance-none truncate rounded-xl border border-[var(--kz-border)] bg-[var(--kz-bg)] py-2 pl-3 pr-10 text-[13px] text-[var(--kz-fg)] disabled:opacity-40"
                          title={
                            keywordOptions.includes(w.searchKeyword)
                              ? w.searchKeyword
                              : '仅重搜当前源'
                          }
                        >
                          <option value="" disabled>
                            {hasKeywordTarget
                              ? '换关键词…'
                              : '先点规则源'}
                          </option>
                          {keywordOptions.map((kw) => (
                            <option key={kw} value={kw} title={kw}>
                              {kw.length > 18 ? `${kw.slice(0, 18)}…` : kw}
                            </option>
                          ))}
                        </select>
                        <span
                          className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[var(--kz-fg-muted)]"
                          aria-hidden
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="none"
                            className="opacity-90"
                          >
                            <path
                              d="M4 6.2L8 10.2L12 6.2"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </span>
                      </div>
                      <span className="w-1/5 min-w-0 shrink-0 text-[11px] leading-snug text-[var(--kz-fg-muted)]">
                        {hasKeywordTarget ? '关键词选择' : '先选源'}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={kwInput}
                        onChange={(e) => setKwInput(e.target.value)}
                        disabled={!hasKeywordTarget}
                        placeholder={
                          hasKeywordTarget
                            ? `自定义 · ${
                                w.keywordTargetPlugin?.name ||
                                w.selection?.plugin.name ||
                                ''
                              }`
                            : '点规则源后再搜'
                        }
                        className="min-w-0 flex-1 rounded-xl border border-[var(--kz-border)] bg-[var(--kz-bg)] px-3 py-2 text-[13px] text-[var(--kz-fg)] outline-none placeholder:text-[var(--kz-fg-dim)] focus:border-[var(--kz-accent)] disabled:opacity-40"
                      />
                      <button
                        type="submit"
                        disabled={!hasKeywordTarget || !kwInput.trim()}
                        className="kz-btn-primary !rounded-xl !px-3.5 !py-2 !text-[13px] disabled:opacity-40"
                      >
                        搜此源
                      </button>
                    </div>
                  </form>
                </div>

                <div className="max-h-[min(42dvh,20rem)] space-y-2 overflow-y-auto px-3 pb-3">
                  {!w.searchResults.length && (
                    <p className="px-1 py-8 text-center text-[13px] text-[var(--kz-fg-muted)]">
                      没有启用的规则。请到设置中启用或导入。
                    </p>
                  )}
                  {w.searchResults.map((r) => {
                    const isTarget =
                      (w.keywordTargetPlugin?.name ||
                        w.selection?.plugin.name) === r.plugin.name
                    const isDefault =
                      r.plugin.name.toLowerCase() ===
                        w.defaultSourceName.toLowerCase() ||
                      r.plugin.name
                        .toLowerCase()
                        .includes(w.defaultSourceName.toLowerCase())
                    const statusLabel = r.pending
                      ? '搜索中…'
                      : r.searched
                        ? r.items.length
                          ? `${r.items.length} 条`
                          : '无结果'
                        : isDefault
                          ? '默认 · 点击搜索'
                          : '点击搜索'
                    return (
                      <div
                        key={r.plugin.id}
                        className={clsx(
                          'rounded-xl border transition',
                          isTarget
                            ? 'border-[var(--kz-accent)]/45 bg-[var(--kz-accent-soft)]'
                            : 'border-[var(--kz-border)] bg-[var(--kz-bg-elevated)]',
                        )}
                      >
                        <button
                          type="button"
                          className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
                          onClick={() => {
                            w.setKeywordTargetPlugin(r.plugin)
                            if (!r.pending) {
                              void w.openPluginSearch(r.plugin)
                            }
                          }}
                          title={
                            isDefault
                              ? `默认源 ${w.defaultSourceName} · 点击搜索`
                              : '点击搜索此源'
                          }
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-[14px] font-semibold tracking-tight text-[var(--kz-fg)]">
                                {r.plugin.name}
                              </span>
                              {isDefault ? (
                                <span className="shrink-0 rounded-full border border-[var(--kz-accent)]/40 bg-[var(--kz-accent-soft)] px-1.5 py-0.5 text-[10px] font-bold leading-none text-[var(--kz-accent)]">
                                  默认
                                </span>
                              ) : null}
                              {isTarget ? (
                                <span className="shrink-0 rounded-full bg-[var(--kz-accent)] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                                  当前
                                </span>
                              ) : null}
                            </span>
                            {r.keyword ? (
                              <span className="mt-1 block truncate text-[12px] text-[var(--kz-fg-muted)]">
                                关键词「{r.keyword}」
                              </span>
                            ) : (
                              <span className="mt-1 block text-[12px] text-[var(--kz-fg-dim)]">
                                {isDefault
                                  ? '进入页面会自动搜索此源'
                                  : '规则源'}
                              </span>
                            )}
                          </span>
                          <span
                            className={clsx(
                              'shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium tabular-nums',
                              r.pending
                                ? 'bg-[var(--kz-bg-soft)] text-[var(--kz-accent)]'
                                : r.searched && r.items.length
                                  ? 'bg-[var(--kz-bg-soft)] text-[var(--kz-fg)]'
                                  : r.searched
                                    ? 'bg-[var(--kz-bg-soft)] text-[var(--kz-fg-muted)]'
                                    : 'bg-[var(--kz-bg-soft)] text-[var(--kz-fg-muted)]',
                            )}
                          >
                            {statusLabel}
                          </span>
                        </button>

                        {!r.pending && r.searched && r.error && (
                          <div className="mx-3.5 mb-2 line-clamp-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[12px] text-amber-300/90">
                            {r.error}
                          </div>
                        )}

                        {r.searched && !r.pending && r.items.length > 0 && (
                          <ul className="max-h-40 space-y-0.5 overflow-y-auto border-t border-[var(--kz-border)] px-2 py-2">
                            {r.items.map((it, idx) => {
                              const selected =
                                w.selection?.plugin.name === r.plugin.name &&
                                w.selection?.source.src === it.src
                              const pending =
                                w.pendingSource?.pluginName ===
                                  r.plugin.name &&
                                w.pendingSource?.src === it.src
                              const score = bestTitleSimilarity(
                                it.name,
                                w.titleRefs,
                              )
                              return (
                                <li
                                  key={`${r.plugin.name}:${it.src}:${idx}`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      w.setKeywordTargetPlugin(r.plugin)
                                      void w.pickSource(r.plugin, it)
                                      setEpsOpen(true)
                                    }}
                                    className={clsx(
                                      'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] leading-snug transition',
                                      selected
                                        ? 'bg-[var(--kz-accent)] font-medium text-white'
                                        : pending
                                          ? 'bg-[var(--kz-accent-soft)] text-[var(--kz-accent)]'
                                          : 'text-[var(--kz-fg)] hover:bg-[var(--kz-bg-hover)]',
                                    )}
                                  >
                                    <span className="min-w-0 flex-1 truncate">
                                      {it.name}
                                    </span>
                                    {score >= 0.85 && (
                                      <span
                                        className={clsx(
                                          'shrink-0 text-[11px] font-medium',
                                          selected
                                            ? 'text-white/80'
                                            : 'text-emerald-400',
                                        )}
                                      >
                                        相近
                                      </span>
                                    )}
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </section>

          {/* —— 选集 —— */}
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--kz-border)] bg-[var(--kz-bg-elevated)]">
            <button
              type="button"
              onClick={() => setEpsOpen((v) => !v)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[var(--kz-bg-hover)]"
            >
              <span
                className={clsx(
                  'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] text-[var(--kz-fg-muted)] transition-transform',
                  epsOpen && 'rotate-90 text-[var(--kz-accent)]',
                )}
                aria-hidden
              >
                ▸
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold tracking-tight text-[var(--kz-fg)]">
                  选集
                </span>
                <span className="mt-0.5 block text-[12px] text-[var(--kz-fg-muted)]">
                  {epCount > 0
                    ? w.episode
                      ? `正在播放第 ${w.episode.episode} 集 · 共 ${epCount} 集`
                      : `共 ${epCount} 集`
                    : '选择搜索结果后加载分集'}
                  {w.selection && w.selection.roads.length > 1
                    ? ` · ${w.selection.roads.length} 条线路`
                    : ''}
                </span>
              </span>
            </button>

            {epsOpen && (
              <div className="flex min-h-0 flex-1 flex-col border-t border-[var(--kz-border)]">
                {/* 线路分类：多线路时必须用 Tab，避免 1/2/3/4 混在同一网格 */}
                {w.selection && w.selection.roads.length > 0 && (
                  <div className="shrink-0 space-y-2 border-b border-[var(--kz-border)] px-3 py-2.5">
                    <div className="text-[11px] font-medium text-[var(--kz-fg-muted)]">
                      线路
                    </div>
                    <div
                      className="flex gap-1.5 overflow-x-auto pb-0.5"
                      role="tablist"
                      aria-label="播放线路"
                    >
                      {w.selection.roads.map((road, ri) => {
                        const active = ri === activeRoadIndex
                        const playingHere = w.episode?.road === ri
                        return (
                          <button
                            key={`${road.name}-${ri}`}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => w.setVisibleRoad(ri)}
                            className={clsx(
                              'shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium transition',
                              active
                                ? 'bg-[var(--kz-accent)] text-white'
                                : 'bg-[var(--kz-bg-soft)] text-[var(--kz-fg-muted)] hover:bg-[var(--kz-bg-hover)] hover:text-[var(--kz-fg)]',
                            )}
                            title={road.name || `线路 ${ri + 1}`}
                          >
                            {road.name?.trim() || `线路 ${ri + 1}`}
                            {road.data?.length ? (
                              <span
                                className={clsx(
                                  'ml-1 tabular-nums',
                                  active ? 'text-white/80' : 'text-[var(--kz-fg-dim)]',
                                )}
                              >
                                {road.data.length}
                              </span>
                            ) : null}
                            {playingHere && !active ? (
                              <span className="ml-1 text-[var(--kz-accent)]">
                                ·播
                              </span>
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                  {w.roadLoading && (
                    <p className="py-6 text-center text-[13px] text-[var(--kz-fg-muted)]">
                      加载分集
                      {w.pendingSource?.pluginName
                        ? `（${w.pendingSource.pluginName}）`
                        : ''}
                      …
                    </p>
                  )}
                  {w.roadError && (
                    <p className="px-1 py-2 text-[13px] text-red-400">
                      {w.roadError}
                    </p>
                  )}
                  {!w.selection && !w.roadLoading && (
                    <p className="py-6 text-center text-[13px] leading-relaxed text-[var(--kz-fg-muted)]">
                      先在上方搜索规则源，
                      <br />
                      再点搜索结果加载分集
                    </p>
                  )}
                  {w.selection && !w.roadLoading && activeRoad && (
                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 lg:grid-cols-4">
                      {activeRoad.identifier.map((name, epIndex) => {
                        const playing =
                          w.episode?.road === activeRoadIndex &&
                          w.episode?.episode === epIndex + 1
                        return (
                          <button
                            key={activeRoad.data[epIndex] + name + epIndex}
                            type="button"
                            onClick={() => {
                              w.pickEpisode(epIndex, activeRoadIndex)
                            }}
                            title={name}
                            className={clsx(
                              'truncate rounded-xl px-1.5 py-2.5 text-center text-[13px] transition',
                              playing
                                ? 'bg-[var(--kz-accent)] font-semibold text-white shadow-sm shadow-sky-900/30'
                                : 'bg-[var(--kz-bg-soft)] text-[var(--kz-fg)] hover:bg-[var(--kz-bg-hover)]',
                            )}
                          >
                            {name}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex shrink-0 gap-2 border-t border-[var(--kz-border)] px-3 py-2.5">
              <button
                type="button"
                onClick={() => w.goAdjacentEpisode(-1)}
                disabled={!w.episode}
                className="flex-1 rounded-xl border border-[var(--kz-border)] bg-transparent py-2 text-[13px] font-medium text-[var(--kz-fg)] hover:bg-[var(--kz-bg-hover)] disabled:opacity-40"
              >
                上一集
              </button>
              <button
                type="button"
                onClick={() => w.goAdjacentEpisode(1)}
                disabled={!w.episode}
                className="flex-1 rounded-xl border border-[var(--kz-border)] bg-transparent py-2 text-[13px] font-medium text-[var(--kz-fg)] hover:bg-[var(--kz-bg-hover)] disabled:opacity-40"
              >
                下一集
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
