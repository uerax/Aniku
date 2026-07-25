import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { CollectType } from '@aniku/shared'
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
import { useWatchLayoutMode } from './watch/useWatchLayoutMode'
import { DesktopWatchLayout } from './watch/DesktopWatchLayout'
import { MobileWatchLayout } from './watch/MobileWatchLayout'
import { WatchMeta } from './watch/WatchMeta'
import { WatchCollapseChevron } from './watch/WatchCollapseChevron'

/**
 * Unified subject + cinema page (Bilibili-style).
 * Used for both /subject/:id and /play/:id — no separate pages.
 * Desktop vs mobile page chrome is split (DesktopWatchLayout / MobileWatchLayout).
 */
export function WatchPage() {
  const { id } = useParams()
  const bangumiId = Number(id)
  const w = useWatchSession(Number.isFinite(bangumiId) ? bangumiId : 0)
  const layoutMode = useWatchLayoutMode()

  const token = useSettingsStore((s) => s.bangumiToken)
  const qc = useQueryClient()
  const [summaryOpen, setSummaryOpen] = useState(false)
  /** Sources open until a selection lands; then auto-collapse to focus 选集 */
  const [sourcesOpen, setSourcesOpen] = useState(true)
  /** Episodes open when we have a selection / resume */
  const [epsOpen, setEpsOpen] = useState(true)
  /** Last selection key we auto-focused (collapse sources / mobile scroll) */
  const focusedSelectionKey = useRef<string | null>(null)

  const [kwInput, setKwInput] = useState('')

  /** Collapse 视频源 + ensure 选集 open; on mobile scroll cinema into view. */
  const focusAfterSelection = useCallback(
    (key: string, opts?: { forceScroll?: boolean }) => {
      if (!key) return
      const already = focusedSelectionKey.current === key
      focusedSelectionKey.current = key
      setEpsOpen(true)
      setSourcesOpen(false)
      if (layoutMode !== 'mobile') return
      if (already && !opts?.forceScroll) return
      // Wait layout paint after collapse before scrolling
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document
            .getElementById('kz-watch-focus')
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      })
    },
    [layoutMode],
  )

  const collection = useQuery({
    queryKey: ['collection', bangumiId, token],
    queryFn: ({ signal }) => bangumiApi.getCollection(bangumiId, { signal }),
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

  // Chapters ready (auto-pick or resume): fold 视频源, open 选集; mobile → scroll to cinema
  useEffect(() => {
    const sel = w.selection
    if (!sel?.roads?.length) return
    const key = `${sel.plugin.name}::${sel.source.src}`
    focusAfterSelection(key)
  }, [w.selection, focusAfterSelection])

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

  const playerBlock = (
    <div className="space-y-2">
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
                ? '在选集区点集数即可播放'
                : `已默认搜索 ${w.defaultSourceName}，请稍候或点下方结果`}
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
  )

  const metaBlock = (
    <WatchMeta
      item={item}
      title={w.title}
      pluginName={w.pluginName}
      episodeLabel={w.episode ? `第 ${w.episode.episode} 集` : null}
      mediaHint={
        w.mediaSrc
          ? w.playbackMode === 'proxy'
            ? '经服务器代理'
            : '直连源站'
          : null
      }
      summaryOpen={summaryOpen}
      onToggleSummary={() => setSummaryOpen((v) => !v)}
      token={token}
      collectType={collectType}
      collectOptions={collectOptions}
      onCollectChange={(t) => setCollect.mutate(t)}
      collectPending={setCollect.isPending}
      compact={layoutMode === 'mobile'}
    />
  )

  const sourcesPanel = (
    <section
      className={clsx(
        'shrink-0 overflow-hidden rounded-2xl border border-[var(--kz-border)] bg-[var(--kz-bg-elevated)]',
        sourcesOpen && 'kz-watch-sources',
      )}
    >
      <button
        type="button"
        onClick={() => setSourcesOpen((v) => !v)}
        className="flex w-full shrink-0 items-center gap-3 px-4 py-3 text-left transition hover:bg-[var(--kz-bg-hover)]"
        aria-expanded={sourcesOpen}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold tracking-tight text-[var(--kz-fg)]">
            视频源
          </span>
          <span className="mt-0.5 block text-[12px] text-[var(--kz-fg-muted)]">
            点源搜索 → 再点条目加载选集
            {w.searchResults.length
              ? ` · ${w.searchResults.filter((r) => r.searched).length}/${w.searchResults.length} 已搜`
              : ''}
          </span>
        </span>
        <WatchCollapseChevron open={sourcesOpen} />
      </button>

            {sourcesOpen && (
              <div className="kz-watch-sources-body border-t border-[var(--kz-border)]">
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

                {/* List scrolls with the whole sources body (capped ≈ player height) */}
                <div className="space-y-2 px-3 pb-3">
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
                    const hasItems =
                      r.searched && !r.pending && r.items.length > 0
                    const selectedInThis =
                      w.selection?.plugin.name === r.plugin.name
                    /** Search done with hits but user hasn't picked a title yet */
                    const needsPick = hasItems && !selectedInThis
                    const statusLabel = r.pending
                      ? '搜索中…'
                      : needsPick
                        ? `点选 · ${r.items.length}`
                        : r.searched
                          ? r.items.length
                            ? selectedInThis
                              ? '已选'
                              : `${r.items.length} 条`
                            : '无结果'
                          : isDefault
                            ? '默认 · 点此搜索'
                            : '点此搜索'
                    return (
                      <div
                        key={r.plugin.id}
                        className={clsx(
                          'rounded-xl border transition',
                          needsPick
                            ? 'border-[var(--kz-accent)] bg-[var(--kz-accent-soft)]/40 shadow-[0_0_0_1px_var(--kz-accent-ring)]'
                            : isTarget
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
                            needsPick
                              ? '已搜到结果，请在下方点选番剧条目'
                              : isDefault
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
                                {needsPick ? ' · 下一步点下方条目' : ''}
                              </span>
                            ) : (
                              <span className="mt-1 block text-[12px] text-[var(--kz-fg-dim)]">
                                {isDefault
                                  ? '进入页面会自动搜索此源'
                                  : '点此开始搜索'}
                              </span>
                            )}
                          </span>
                          <span
                            className={clsx(
                              'shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium tabular-nums',
                              r.pending
                                ? 'bg-[var(--kz-bg-soft)] text-[var(--kz-accent)]'
                                : needsPick
                                  ? 'bg-[var(--kz-accent)] text-white'
                                  : selectedInThis
                                    ? 'bg-[var(--kz-accent-soft)] text-[var(--kz-accent)]'
                                    : r.searched && r.items.length
                                      ? 'bg-[var(--kz-bg-soft)] text-[var(--kz-fg)]'
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

                        {hasItems && (
                          <div className="border-t border-[var(--kz-border)]">
                            {needsPick && (
                              <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1 text-[12px] font-medium text-[var(--kz-accent)]">
                                <span aria-hidden>↓</span>
                                <span>点选匹配条目，加载分集</span>
                              </div>
                            )}
                            <ul
                              className={clsx(
                                'max-h-40 space-y-1 overflow-y-auto px-2',
                                needsPick ? 'pb-2.5 pt-1' : 'py-2',
                              )}
                              aria-label={`${r.plugin.name} 搜索结果，点击条目加载选集`}
                            >
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
                                        // Immediate fold + mobile scroll; effect also runs when roads arrive
                                        focusAfterSelection(
                                          `${r.plugin.name}::${it.src}`,
                                          { forceScroll: true },
                                        )
                                      }}
                                      className={clsx(
                                        'flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[13px] leading-snug transition',
                                        selected
                                          ? 'bg-[var(--kz-accent)] font-medium text-white'
                                          : pending
                                            ? 'bg-[var(--kz-accent-soft)] text-[var(--kz-accent)]'
                                            : needsPick
                                              ? 'bg-[var(--kz-bg)] text-[var(--kz-fg)] ring-1 ring-[var(--kz-border)] hover:bg-[var(--kz-bg-hover)] hover:ring-[var(--kz-accent)]'
                                              : 'text-[var(--kz-fg)] hover:bg-[var(--kz-bg-hover)]',
                                      )}
                                    >
                                      <span className="min-w-0 flex-1 truncate">
                                        {it.name}
                                      </span>
                                      {selected ? (
                                        <span className="shrink-0 text-[11px] font-medium text-white/85">
                                          播放中
                                        </span>
                                      ) : pending ? (
                                        <span className="shrink-0 text-[11px] font-medium text-[var(--kz-accent)]">
                                          加载中
                                        </span>
                                      ) : (
                                        <span
                                          className={clsx(
                                            'shrink-0 text-[11px] font-medium',
                                            needsPick
                                              ? 'text-[var(--kz-accent)]'
                                              : score >= 0.85
                                                ? 'text-emerald-400'
                                                : 'text-[var(--kz-fg-dim)]',
                                          )}
                                        >
                                          {needsPick
                                            ? '选用'
                                            : score >= 0.85
                                              ? '相近'
                                              : '选用'}
                                        </span>
                                      )}
                                    </button>
                                  </li>
                                )
                              })}
                            </ul>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
      </div>
    )}
    </section>
  )

  const epsPanel = (
    <section
      className={clsx(
        'kz-watch-eps-panel shrink-0 overflow-hidden rounded-2xl border border-[var(--kz-border)] bg-[var(--kz-bg-elevated)]',
        epsOpen && 'kz-watch-eps',
      )}
    >
      <button
        type="button"
        onClick={() => setEpsOpen((v) => !v)}
        className="flex w-full shrink-0 items-center gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-[var(--kz-bg-hover)] sm:gap-3 sm:px-4 sm:py-3"
        aria-expanded={epsOpen}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-bold tracking-tight text-[var(--kz-fg)] sm:text-[15px]">
            选集
          </span>
          <span className="mt-0.5 block text-[11px] text-[var(--kz-fg-muted)] sm:text-[12px]">
            {epCount > 0
              ? w.episode
                ? `第 ${w.episode.episode} 集 · 共 ${epCount} 集`
                : `共 ${epCount} 集`
              : '点选视频源结果后加载'}
            {w.selection && w.selection.roads.length > 1
              ? ` · ${w.selection.roads.length} 线路`
              : w.selection?.roads?.[0]?.name
                ? ` · ${w.selection.roads[0].name}`
                : ''}
          </span>
        </span>
        <WatchCollapseChevron open={epsOpen} />
      </button>

      {epsOpen && (
        <div className="border-t border-[var(--kz-border)]">
          {/* 线路：描边 chip，与集数实心块区分色/形 */}
          {w.selection && w.selection.roads.length > 0 && (
            <div className="kz-watch-roads space-y-1.5 border-b border-[var(--kz-border)] px-2.5 py-2 sm:space-y-2 sm:px-3 sm:py-2.5">
              {w.selection.roads.length > 1 ? (
                <div className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--kz-fg-dim)] sm:text-[11px]">
                  线路
                </div>
              ) : null}
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
                        'kz-watch-road-chip shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition sm:rounded-full sm:px-3 sm:py-1.5 sm:text-[12px]',
                        active
                          ? 'border border-violet-400/50 bg-violet-500/15 text-violet-300'
                          : 'border border-[var(--kz-border)] bg-transparent text-[var(--kz-fg-muted)] hover:border-violet-400/35 hover:text-[var(--kz-fg)]',
                      )}
                      title={road.name || `线路 ${ri + 1}`}
                    >
                      {road.name?.trim() || `线路 ${ri + 1}`}
                      {road.data?.length ? (
                        <span
                          className={clsx(
                            'ml-1 tabular-nums font-medium',
                            active ? 'text-violet-300/80' : 'text-[var(--kz-fg-dim)]',
                          )}
                        >
                          {road.data.length}
                        </span>
                      ) : null}
                      {playingHere && !active ? (
                        <span className="ml-1 text-[var(--kz-accent)]">·播</span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="kz-watch-eps-body px-2.5 py-2 sm:px-3 sm:py-3">
            {w.roadLoading && (
              <p className="py-5 text-center text-[12px] text-[var(--kz-fg-muted)] sm:py-6 sm:text-[13px]">
                加载分集
                {w.pendingSource?.pluginName
                  ? `（${w.pendingSource.pluginName}）`
                  : ''}
                …
              </p>
            )}
            {w.roadError && (
              <p className="px-1 py-2 text-[12px] text-red-400 sm:text-[13px]">
                {w.roadError}
              </p>
            )}
            {!w.selection && !w.roadLoading && (
              <p className="py-5 text-center text-[12px] leading-relaxed text-[var(--kz-fg-muted)] sm:py-6 sm:text-[13px]">
                {layoutMode === 'mobile' ? (
                  <>
                    ① 在下方「视频源」点规则搜索
                    <br />
                    ② 再点搜出的番剧条目加载分集
                  </>
                ) : (
                  <>
                    ① 在上方「视频源」点规则搜索
                    <br />
                    ② 再点搜出的番剧条目加载分集
                  </>
                )}
              </p>
            )}
            {w.selection && !w.roadLoading && activeRoad && (
              <div className="kz-watch-ep-grid grid grid-cols-5 gap-1.5 sm:grid-cols-5 sm:gap-2 lg:grid-cols-4">
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
                        'kz-watch-ep-btn truncate rounded-lg px-1 py-1.5 text-center text-[12px] font-medium transition sm:rounded-xl sm:px-1.5 sm:py-2 sm:text-[13px]',
                        playing
                          ? 'bg-[var(--kz-accent)] font-semibold text-white shadow-sm shadow-sky-900/25'
                          : 'bg-[var(--kz-bg-soft)] text-[var(--kz-fg)] hover:bg-[var(--kz-bg-hover)]',
                      )}
                    >
                      {name}
                    </button>
                  )
                })}
              </div>
            )}
            {w.selection &&
              !w.roadLoading &&
              !activeRoad &&
              w.selection.roads.length > 0 && (
                <p className="py-5 text-center text-[12px] text-[var(--kz-fg-muted)] sm:py-6 sm:text-[13px]">
                  请选择上方线路查看集数
                </p>
              )}
          </div>
        </div>
      )}
    </section>
  )

  /* Desktop rail: sources then episodes (right column). */
  const rail = (
    <>
      {sourcesPanel}
      {epsPanel}
    </>
  )

  return (
    <div className="kz-watch -mx-4 -mt-2 sm:mx-0 sm:mt-0">
      {layoutMode === 'desktop' ? (
        <DesktopWatchLayout
          player={playerBlock}
          meta={metaBlock}
          rail={rail}
        />
      ) : (
        /* Mobile: 选集 above player so ep switch is one scroll away from top */
        <MobileWatchLayout
          meta={metaBlock}
          episodes={epsPanel}
          player={playerBlock}
          sources={sourcesPanel}
        />
      )}
    </div>
  )
}
