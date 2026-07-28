import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { CollectType } from '@animaku/shared'
import {
  useWatchSession,
  bestTitleSimilarity,
} from '../lib/use-watch-session'
import { bangumiApi } from '../lib/bangumi'
import { useSettingsStore } from '../stores/settings'
import { ErrorState } from '../components/ui'
import {
  EmbedPlayerSuspense,
  VideoPlayerSuspense,
  preloadVideoPlayer,
} from '../player/lazy'
import { useWatchLayoutMode } from './watch/useWatchLayoutMode'
import { DesktopWatchLayout } from './watch/DesktopWatchLayout'
import { MobileWatchLayout } from './watch/MobileWatchLayout'
import { WatchMeta } from './watch/WatchMeta'
import { MobileEpsSection } from './watch/MobileEpsSection'

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
  /** Mobile: whole meta card collapsed to 2 lines until expanded */
  const [metaOpen, setMetaOpen] = useState(false)
  /** Sources open until a selection lands; then auto-collapse to focus 选集 */
  const [sourcesOpen, setSourcesOpen] = useState(true)
  /** Bilibili strip: false = horizontal cards, true = full grid (desktop + mobile) */
  const [epsListExpanded, setEpsListExpanded] = useState(false)
  /** Last selection key we auto-focused (collapse sources / mobile scroll) */
  const focusedSelectionKey = useRef<string | null>(null)
  /**
   * Selection key we already auto-expanded.
   * Avoids re-forcing grid after the user collapses「全 N 话」.
   */
  const autoExpandedEpsKey = useRef<string | null>(null)

  const [kwInput, setKwInput] = useState('')

  /** Collapse 视频源; default 选集 to full grid; on mobile scroll cinema into view. */
  const focusAfterSelection = useCallback(
    (key: string, opts?: { forceScroll?: boolean }) => {
      if (!key) return
      const already = focusedSelectionKey.current === key
      focusedSelectionKey.current = key
      setSourcesOpen(false)
      // 选源后默认「全 N 话」网格（每源只自动展开一次，用户可再收起）
      if (autoExpandedEpsKey.current !== key) {
        autoExpandedEpsKey.current = key
        setEpsListExpanded(true)
      }
      if (layoutMode !== 'mobile') return
      if (already && !opts?.forceScroll) return
      // Wait layout paint after collapse before scrolling.
      // nearest: sticky portrait player already fills the top — avoid big jumps.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document
            .getElementById('kz-watch-focus')
            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
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

  // Chapters ready (auto-pick or resume): fold 视频源; 选集默认网格; mobile scroll
  useEffect(() => {
    const sel = w.selection
    if (!sel?.roads?.length) return
    const key = `${sel.plugin.name}::${sel.source.src}`
    focusAfterSelection(key)
  }, [w.selection, focusAfterSelection])

  // Warm player JS as soon as watch route is active (import only).
  // Must run before any conditional return — Rules of Hooks.
  useEffect(() => {
    preloadVideoPlayer()
  }, [])

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
    // Keep cinema shell height stable while subject meta loads (CLS).
    return (
      <div className="kz-watch px-4 sm:px-0">
        <div className="kz-player-stack mx-auto space-y-3">
          <div className="kz-player-placeholder text-sm text-[var(--kz-fg-muted)]">
            <div className="flex flex-col items-center gap-2">
              <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[var(--kz-border)] border-t-[var(--kz-accent)]" />
              加载条目…
            </div>
          </div>
          <div className="kz-watch-panel space-y-2 px-3 py-3">
            <div className="kz-skeleton h-4 w-2/3 rounded-md" />
            <div className="kz-skeleton h-3 w-1/2 rounded-md" />
            <div className="kz-skeleton h-3 w-full rounded-md" />
          </div>
        </div>
      </div>
    )
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
          ? w.playbackTransit === 'playlist-proxy'
            ? '列表代理·分片直连'
            : w.playbackTransit === 'direct' || w.playbackMode === 'direct'
              ? '直连源站'
              : '经服务器代理'
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
      metaOpen={layoutMode === 'mobile' ? metaOpen : true}
      onToggleMeta={
        layoutMode === 'mobile' ? () => setMetaOpen((v) => !v) : undefined
      }
    />
  )

  const sourcesSearched = w.searchResults.filter((r) => r.searched).length
  const sourcesTotal = w.searchResults.length
  const sourcesSummary = w.selection
    ? `${w.pluginName || w.selection.plugin.name}${
        w.episode ? ` · 第 ${w.episode.episode} 集` : ''
      }${sourcesTotal ? ` · ${sourcesSearched}/${sourcesTotal} 已搜` : ''}`
    : sourcesTotal
      ? `${sourcesSearched}/${sourcesTotal} 已搜 · 点源搜索后选条目`
      : '点源搜索 → 再点条目加载选集'

  const sourcesPanel = (
    <section
      className={clsx(
        /* Keep kz-watch-sources / -panel class hooks for desktop scroll CSS */
        'kz-watch-sources-panel kz-watch-panel kz-bili-panel shrink-0 overflow-hidden',
        sourcesOpen && 'kz-watch-sources',
      )}
    >
      {/* bilibili 侧栏头：标题 + 摘要 + chevron */}
      <button
        type="button"
        onClick={() => setSourcesOpen((v) => !v)}
        className="kz-bili-sec-head kz-bili-sec-head--btn"
        aria-expanded={sourcesOpen}
      >
        <span className="kz-bili-sec-title">
          视频源
          {sourcesTotal > 0 ? (
            <span className="kz-bili-sec-count">
              ({sourcesSearched}/{sourcesTotal})
            </span>
          ) : null}
        </span>
        <span className="kz-bili-sec-summary" title={sourcesSummary}>
          {w.selection
            ? `${w.pluginName || w.selection.plugin.name}${
                w.episode ? ` · 第${w.episode.episode}集` : ''
              }`
            : sourcesTotal
              ? '点源搜索后选条目'
              : '点源搜索'}
        </span>
        <span className="kz-bili-sec-more" aria-hidden>
          <svg
            className="kz-bili-chevron"
            data-open={sourcesOpen ? 'true' : 'false'}
            viewBox="0 0 16 16"
            fill="none"
          >
            <path
              d="M4 6.2L8 10.2L12 6.2"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {sourcesOpen && (
        <div className="kz-watch-sources-body">
          <div className="kz-bili-kw">
            <form onSubmit={onKeywordSubmit} className="kz-bili-kw-form">
              {/* 关键词高度仍由 .kz-kw-* 锁定 */}
              <div className="kz-bili-kw-row">
                <div className="relative min-w-0 flex-1">
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
                    className="kz-kw-select kz-bili-kw-select w-full appearance-none truncate py-0 pl-2 pr-5 text-[var(--kz-fg)] outline-none disabled:opacity-40"
                    title={
                      keywordOptions.includes(w.searchKeyword)
                        ? w.searchKeyword
                        : hasKeywordTarget
                          ? '选择关键词重搜'
                          : '先点规则源'
                    }
                  >
                    <option value="" disabled>
                      {hasKeywordTarget
                        ? keywordOptions.length
                          ? '选择关键词…'
                          : '暂无候选'
                        : '先点下方规则源'}
                    </option>
                    {keywordOptions.map((kw) => (
                      <option key={kw} value={kw} title={kw}>
                        {kw}
                      </option>
                    ))}
                  </select>
                  <span
                    className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center text-[var(--kz-fg-muted)]"
                    aria-hidden
                  >
                    <svg width="8" height="8" viewBox="0 0 16 16" fill="none">
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
              </div>
              <div className="kz-bili-kw-row">
                <input
                  value={kwInput}
                  onChange={(e) => setKwInput(e.target.value)}
                  disabled={!hasKeywordTarget}
                  placeholder={
                    hasKeywordTarget ? '自定义关键词' : '点规则源后再搜'
                  }
                  className="kz-kw-input kz-bili-kw-input min-w-0 flex-1 px-2 py-0 text-[var(--kz-fg)] outline-none placeholder:text-[var(--kz-fg-dim)] disabled:opacity-40"
                />
                <button
                  type="submit"
                  disabled={!hasKeywordTarget || !kwInput.trim()}
                  className="kz-kw-search-btn kz-bili-kw-btn shrink-0 disabled:opacity-40"
                >
                  搜索
                </button>
              </div>
            </form>
          </div>

          <div className="kz-bili-source-list">
            {!w.searchResults.length && (
              <div className="kz-bili-empty">
                <p>没有启用的规则。请到设置中启用或导入。</p>
                <Link
                  to="/settings"
                  className="mt-1 font-medium text-[var(--kz-accent)] hover:underline"
                >
                  打开设置
                </Link>
              </div>
            )}
            {w.searchResults.map((r) => {
              const isTarget =
                (w.keywordTargetPlugin?.name || w.selection?.plugin.name) ===
                r.plugin.name
              const isDefault =
                r.plugin.name.toLowerCase() ===
                  w.defaultSourceName.toLowerCase() ||
                r.plugin.name
                  .toLowerCase()
                  .includes(w.defaultSourceName.toLowerCase())
              const hasItems = r.searched && !r.pending && r.items.length > 0
              const selectedInThis = w.selection?.plugin.name === r.plugin.name
              const needsPick = hasItems && !selectedInThis
              const statusLabel = r.pending
                ? '搜索中'
                : needsPick
                  ? `点选·${r.items.length}`
                  : r.searched
                    ? r.items.length
                      ? selectedInThis
                        ? '已选'
                        : `${r.items.length}条`
                      : '无结果'
                    : '点搜'
              return (
                <div
                  key={r.plugin.id}
                  className={clsx(
                    'kz-bili-source',
                    needsPick && 'kz-bili-source--pick',
                    isTarget && !needsPick && 'kz-bili-source--active',
                  )}
                >
                  <button
                    type="button"
                    className="kz-bili-source-row"
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
                    <span className="kz-bili-source-avatar" aria-hidden>
                      {(r.plugin.name.trim().charAt(0) || '?').toUpperCase()}
                    </span>
                    <span className="kz-bili-source-main min-w-0 flex-1">
                      <span className="kz-bili-source-name-row">
                        <span className="kz-bili-source-name">
                          {r.plugin.name}
                        </span>
                        {isDefault ? (
                          <span className="kz-bili-tag">默认</span>
                        ) : null}
                        {isTarget ? (
                          <span className="kz-bili-tag kz-bili-tag--accent">
                            当前
                          </span>
                        ) : null}
                      </span>
                      <span className="kz-bili-source-sub">
                        {r.keyword
                          ? `「${r.keyword}」${needsPick ? ' · 点选条目' : ''}`
                          : isDefault
                            ? '自动搜此源'
                            : '点此搜索'}
                      </span>
                    </span>
                    <span
                      className={clsx(
                        'kz-bili-source-action',
                        r.pending && 'kz-bili-source-action--pending',
                        needsPick && 'kz-bili-source-action--pick',
                        selectedInThis &&
                          !needsPick &&
                          'kz-bili-source-action--done',
                      )}
                    >
                      {statusLabel}
                    </span>
                  </button>

                  {!r.pending && r.searched && r.error && (
                    <div className="kz-bili-source-error">{r.error}</div>
                  )}

                  {hasItems && (
                    <ul
                      className={clsx(
                        'kz-bili-hits',
                        needsPick && 'kz-bili-hits--emphasis',
                      )}
                      aria-label={`${r.plugin.name} 搜索结果，点击条目加载选集`}
                    >
                      {needsPick && (
                        <li className="kz-bili-hits-tip">点选条目加载分集</li>
                      )}
                      {r.items.map((it, idx) => {
                        const selected =
                          w.selection?.plugin.name === r.plugin.name &&
                          w.selection?.source.src === it.src
                        const pending =
                          w.pendingSource?.pluginName === r.plugin.name &&
                          w.pendingSource?.src === it.src
                        const score = bestTitleSimilarity(it.name, w.titleRefs)
                        return (
                          <li key={`${r.plugin.name}:${it.src}:${idx}`}>
                            <button
                              type="button"
                              onClick={() => {
                                w.setKeywordTargetPlugin(r.plugin)
                                void w.pickSource(r.plugin, it)
                                focusAfterSelection(
                                  `${r.plugin.name}::${it.src}`,
                                  { forceScroll: true },
                                )
                              }}
                              className={clsx(
                                'kz-bili-hit',
                                selected && 'kz-bili-hit--on',
                                pending && !selected && 'kz-bili-hit--pending',
                              )}
                            >
                              <span className="kz-bili-hit-title">{it.name}</span>
                              <span className="kz-bili-hit-meta">
                                {selected ? (
                                  <>
                                    <span
                                      className="kz-bili-hit-live"
                                      aria-hidden
                                    />
                                    播放中
                                  </>
                                ) : pending ? (
                                  '加载中'
                                ) : needsPick ? (
                                  '选用'
                                ) : score >= 0.85 ? (
                                  '相近'
                                ) : (
                                  '选用'
                                )}
                              </span>
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
  )

  /* Bilibili-style 选集 — shared desktop rail + mobile */
  const epsPanel = (
    <MobileEpsSection
      roads={w.selection?.roads ?? []}
      activeRoadIndex={activeRoadIndex}
      playingRoad={w.episode?.road}
      playingEpisode={w.episode?.episode}
      epCount={epCount}
      listExpanded={epsListExpanded}
      roadLoading={w.roadLoading}
      roadError={w.roadError || null}
      pendingPluginName={w.pendingSource?.pluginName}
      hasSelection={Boolean(w.selection)}
      onToggleList={() => setEpsListExpanded((v) => !v)}
      onSelectRoad={w.setVisibleRoad}
      onPickEpisode={w.pickEpisode}
    />
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
        // Mobile: player → meta → 视频源 → 选集 (Bilibili-style)
        <MobileWatchLayout
          player={playerBlock}
          meta={metaBlock}
          sources={sourcesPanel}
          episodes={epsPanel}
        />
      )}
    </div>
  )
}
