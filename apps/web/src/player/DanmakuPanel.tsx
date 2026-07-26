import type {
  DanmakuAnime,
  DanmakuEpisode,
  DanmakuSettings,
} from '@animaku/shared'
import type { DanmakuSourceChip } from '../lib/danmaku-pools'
import type { DanmakuPoolId } from '../lib/danmaku-pools'
import type { PointerMode } from './chrome/usePointerMode'

export type DanmakuPanelTab = 'search' | 'settings' | 'import'

interface Props {
  open: boolean
  tab: DanmakuPanelTab
  onTabChange: (t: DanmakuPanelTab) => void
  onClose: () => void
  status: string
  /** total loaded across all sources */
  commentsCount: number
  /** currently drawn (enabled sources) */
  visibleCount?: number
  danmaku: DanmakuSettings
  onDanmakuChange: (partial: Partial<DanmakuSettings>) => void
  keyword: string
  onKeywordChange: (v: string) => void
  onSearch: () => void
  searchBusy?: boolean
  animes: DanmakuAnime[]
  episodes: DanmakuEpisode[]
  animeId: number | ''
  episodeId: number | ''
  onAnimeChange: (id: number) => void
  onEpisodeChange: (id: number) => void
  bvInput: string
  onBvInputChange: (v: string) => void
  bvPage: number
  onBvPageChange: (p: number) => void
  onLoadBilibili: () => void
  bilibiliBusy?: boolean
  onPickXmlFile: () => void
  filterDraft: string
  onFilterDraftChange: (v: string) => void
  onAddFilter: () => void
  onRemoveFilter: (rule: string) => void
  /** Multi-source chips under panel content */
  sources?: DanmakuSourceChip[]
  onToggleSource?: (id: DanmakuPoolId) => void
  /** Bottom offset so desktop panel sits above player controls */
  bottomOffset?: number
  /**
   * chrome layout — mobile gets a compact bottom sheet;
   * desktop keeps the floating side card. Defaults to desktop.
   */
  layout?: PointerMode
}

const TABS = [
  ['search', '搜索'],
  ['settings', '设置'],
  ['import', '导入'],
] as const

export function DanmakuPanel(props: Props) {
  if (!props.open) return null

  const layout = props.layout ?? 'desktop'
  if (layout === 'mobile') {
    return <MobileSheet {...props} />
  }
  return <DesktopCard {...props} />
}

/* ─── Desktop floating card (unchanged interaction model) ─── */

function DesktopCard(props: Props) {
  const {
    tab,
    onTabChange,
    onClose,
    status,
    commentsCount,
    visibleCount,
    danmaku,
    onDanmakuChange,
    sources,
    onToggleSource,
    bottomOffset = 56,
  } = props

  const shown =
    typeof visibleCount === 'number' ? visibleCount : commentsCount

  return (
    <div
      className="kz-danmaku-panel kz-danmaku-panel--desktop absolute right-2 z-[60] flex w-[min(22rem,calc(100%-1rem))] flex-col overflow-hidden rounded-xl border border-[var(--kz-border)] bg-[var(--kz-bg-elevated)] shadow-2xl backdrop-blur-md"
      style={{
        bottom: bottomOffset,
        maxHeight: `min(26rem, calc(100% - ${Math.max(bottomOffset, 8)}px - 0.5rem))`,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="弹幕面板"
      data-player-chrome
    >
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--kz-border)] px-3 py-2">
        <div className="flex gap-1">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              data-active={tab === id}
              className="rounded-md px-2.5 py-1 text-xs transition-colors data-[active=true]:bg-[var(--kz-accent)] data-[active=true]:text-white data-[active=false]:text-[var(--kz-fg)] data-[active=false]:hover:bg-[var(--kz-bg-soft)]"
              onClick={() => onTabChange(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-[var(--kz-fg-muted)] hover:bg-[var(--kz-bg-soft)] hover:text-[var(--kz-fg)]"
          aria-label="关闭弹幕面板"
        >
          ✕
        </button>
      </div>

      <div className="kz-danmaku-panel-body flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-[var(--kz-border)] px-3 py-2 text-xs leading-snug text-[var(--kz-fg-muted)]">
          {status || '—'}
          {commentsCount > 0 ? (
            <span className="ml-2 text-[var(--kz-accent)]">
              · 共 {commentsCount} 条
              {shown !== commentsCount ? ` · 显示 ${shown}` : ''}
            </span>
          ) : null}
        </div>
        <div className="kz-danmaku-panel-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 text-sm">
          {tab === 'search' && <SearchTab {...props} compact={false} />}
          {tab === 'settings' && (
            <SettingsTab
              danmaku={danmaku}
              onDanmakuChange={onDanmakuChange}
              compact={false}
            />
          )}
          {tab === 'import' && <ImportTab {...props} compact={false} />}
        </div>
      </div>

      <SourcesFooter sources={sources} onToggleSource={onToggleSource} compact={false} />
    </div>
  )
}

/* ─── Mobile bottom sheet: dense, touch-first ─── */

function MobileSheet(props: Props) {
  const { tab, onTabChange, onClose, danmaku, onDanmakuChange } = props

  return (
    <>
      {/* Dimmed backdrop — tap closes */}
      <button
        type="button"
        className="kz-danmaku-sheet-scrim"
        aria-label="关闭弹幕面板"
        onClick={onClose}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      />
      <div
        className="kz-danmaku-panel kz-danmaku-panel--mobile"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="弹幕面板"
        data-player-chrome
      >
        <div className="kz-danmaku-sheet-handle" aria-hidden />
        <div className="kz-danmaku-sheet-head">
          <div className="kz-danmaku-sheet-tabs" role="tablist">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                data-active={tab === id}
                className="kz-danmaku-sheet-tab"
                onClick={() => onTabChange(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="kz-danmaku-sheet-close"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/*
          Mobile only: no status line / sources footer here —
          WatchPage already shows them under the player. Keep the sheet
          content-sized so short tabs (search) don't leave a blank gap.
        */}
        <div className="kz-danmaku-sheet-scroll">
          {tab === 'search' && <SearchTab {...props} compact />}
          {tab === 'settings' && (
            <SettingsTab
              danmaku={danmaku}
              onDanmakuChange={onDanmakuChange}
              compact
            />
          )}
          {tab === 'import' && <ImportTab {...props} compact />}
        </div>
      </div>
    </>
  )
}

function SourcesFooter({
  sources,
  onToggleSource,
  compact,
}: {
  sources?: DanmakuSourceChip[]
  onToggleSource?: (id: DanmakuPoolId) => void
  compact: boolean
}) {
  if (!sources?.some((s) => s.loaded) || !onToggleSource) return null
  const loaded = sources.filter((s) => s.loaded)
  return (
    <div
      className={
        compact
          ? 'kz-danmaku-panel-sources kz-danmaku-sheet-sources'
          : 'kz-danmaku-panel-sources shrink-0 border-t border-[var(--kz-border)] px-3 py-2'
      }
    >
      <div
        className={
          compact
            ? 'kz-danmaku-sheet-sources-label'
            : 'mb-1.5 text-[11px] text-[var(--kz-fg-muted)]'
        }
      >
        弹幕源
      </div>
      <div className={compact ? 'kz-danmaku-sheet-chips' : 'flex flex-wrap gap-1.5'}>
        {loaded.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onToggleSource(s.id)}
            title={
              s.enabled
                ? `点击关闭「${s.label}」${s.meta ? ` · ${s.meta}` : ''}`
                : `点击显示「${s.label}」${s.meta ? ` · ${s.meta}` : ''}`
            }
            className={
              s.enabled
                ? compact
                  ? 'kz-danmaku-sheet-chip kz-danmaku-sheet-chip--on'
                  : 'rounded-full bg-[var(--kz-accent)] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[var(--kz-accent-hover)]'
                : compact
                  ? 'kz-danmaku-sheet-chip'
                  : 'rounded-full bg-[var(--kz-bg-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--kz-fg-muted)] ring-1 ring-[var(--kz-border)] hover:text-[var(--kz-fg)]'
            }
          >
            {s.label}
            <span className={compact ? 'kz-danmaku-sheet-chip-n' : 'ml-1 opacity-80'}>
              {s.count}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ─── Tab bodies ─── */

function SearchTab({ compact, ...props }: Props & { compact: boolean }) {
  if (compact) {
    return (
      <div className="kz-dm-form">
        <div className="kz-dm-row">
          <input
            className="kz-dm-input"
            value={props.keyword}
            onChange={(e) => props.onKeywordChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') props.onSearch()
            }}
            placeholder="弹弹play 番名"
            enterKeyHint="search"
          />
          <button
            type="button"
            disabled={props.searchBusy}
            onClick={props.onSearch}
            className="kz-dm-btn-primary"
          >
            {props.searchBusy ? '…' : '搜索'}
          </button>
        </div>

        <label className="kz-dm-field">
          <span className="kz-dm-label">番剧</span>
          <select
            className="kz-dm-select"
            value={props.animeId === '' ? '' : String(props.animeId)}
            onChange={(e) => {
              const v = e.target.value
              if (v) props.onAnimeChange(Number(v))
            }}
          >
            <option value="">选择番剧…</option>
            {props.animes.map((a) => (
              <option key={a.animeId} value={a.animeId}>
                {a.animeTitle}
                {a.typeDescription ? ` (${a.typeDescription})` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="kz-dm-field">
          <span className="kz-dm-label">章节</span>
          <select
            className="kz-dm-select"
            value={props.episodeId === '' ? '' : String(props.episodeId)}
            onChange={(e) => {
              const v = e.target.value
              if (v) props.onEpisodeChange(Number(v))
            }}
          >
            <option value="">选择章节…</option>
            {props.episodes.map((ep) => (
              <option key={ep.episodeId} value={ep.episodeId}>
                {ep.episodeTitle}
              </option>
            ))}
          </select>
        </label>

        <p className="kz-dm-hint">
          弹弹写入「弹弹」源；B 站 / XML 默认追加。源开关在播放器下方。
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      <label className="block space-y-1">
        <span className="text-xs text-[var(--kz-fg-muted)]">弹弹play 番名</span>
        <div className="flex gap-2">
          <input
            className="w-full rounded-lg border border-[var(--kz-border)] bg-[var(--kz-bg)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--kz-accent)]"
            value={props.keyword}
            onChange={(e) => props.onKeywordChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') props.onSearch()
            }}
            placeholder="搜索番剧名称…"
          />
          <button
            type="button"
            disabled={props.searchBusy}
            onClick={props.onSearch}
            className="shrink-0 rounded-lg bg-[var(--kz-accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--kz-accent-hover)] disabled:opacity-50"
          >
            {props.searchBusy ? '…' : '搜索'}
          </button>
        </div>
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-[var(--kz-fg-muted)]">番剧</span>
        <select
          className="w-full rounded-lg border border-[var(--kz-border)] bg-[var(--kz-bg)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--kz-accent)]"
          value={props.animeId === '' ? '' : String(props.animeId)}
          onChange={(e) => {
            const v = e.target.value
            if (v) props.onAnimeChange(Number(v))
          }}
        >
          <option value="">选择番剧…</option>
          {props.animes.map((a) => (
            <option key={a.animeId} value={a.animeId}>
              {a.animeTitle}
              {a.typeDescription ? ` (${a.typeDescription})` : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-[var(--kz-fg-muted)]">章节</span>
        <select
          className="w-full rounded-lg border border-[var(--kz-border)] bg-[var(--kz-bg)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--kz-accent)]"
          value={props.episodeId === '' ? '' : String(props.episodeId)}
          onChange={(e) => {
            const v = e.target.value
            if (v) props.onEpisodeChange(Number(v))
          }}
        >
          <option value="">选择章节…</option>
          {props.episodes.map((ep) => (
            <option key={ep.episodeId} value={ep.episodeId}>
              {ep.episodeTitle}
            </option>
          ))}
        </select>
      </label>

      <p className="text-[11px] leading-relaxed text-[var(--kz-fg-muted)]">
        弹弹play 匹配会写入「弹弹」源。B 站 / XML 导入默认追加，不会覆盖弹弹；可在面板底部开关各源。
      </p>
    </div>
  )
}

function SettingsTab({
  danmaku,
  onDanmakuChange,
  compact,
}: {
  danmaku: DanmakuSettings
  onDanmakuChange: (partial: Partial<DanmakuSettings>) => void
  compact: boolean
}) {
  if (compact) {
    return (
      <div className="kz-dm-form">
        <button
          type="button"
          className="kz-dm-toggle-row"
          onClick={() => onDanmakuChange({ enabled: !danmaku.enabled })}
          aria-pressed={danmaku.enabled}
        >
          <span>显示弹幕</span>
          <span
            className={
              danmaku.enabled ? 'kz-dm-switch kz-dm-switch--on' : 'kz-dm-switch'
            }
            aria-hidden
          />
        </button>

        <RangeRow
          label="透明度"
          value={danmaku.opacity}
          min={0.1}
          max={1}
          step={0.05}
          display={`${Math.round(danmaku.opacity * 100)}%`}
          onChange={(v) => onDanmakuChange({ opacity: v })}
          compact
        />
        <RangeRow
          label="字号"
          value={danmaku.fontSize}
          min={0.5}
          max={2}
          step={0.05}
          display={`${danmaku.fontSize.toFixed(2)}×`}
          onChange={(v) => onDanmakuChange({ fontSize: v })}
          compact
        />
        <RangeRow
          label="速度"
          value={danmaku.speed}
          min={0.5}
          max={2}
          step={0.05}
          display={`${danmaku.speed.toFixed(2)}×`}
          onChange={(v) => onDanmakuChange({ speed: v })}
          compact
        />
        <RangeRow
          label="区域"
          value={danmaku.area}
          min={0.2}
          max={1}
          step={0.05}
          display={`${Math.round(danmaku.area * 100)}%`}
          onChange={(v) => onDanmakuChange({ area: v })}
          compact
        />

        <label className="kz-dm-inline-num">
          <span>时间偏移 (秒)</span>
          <input
            type="number"
            step={0.5}
            inputMode="decimal"
            value={danmaku.timeOffset}
            onChange={(e) =>
              onDanmakuChange({ timeOffset: Number(e.target.value) || 0 })
            }
            className="kz-dm-num"
          />
        </label>

        <div className="kz-dm-chip-toggles">
          {(
            [
              ['showScroll', '滚动'],
              ['showTop', '顶部'],
              ['showBottom', '底部'],
              ['showColor', '彩色'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              data-on={danmaku[key]}
              className="kz-dm-type-chip"
              onClick={() => onDanmakuChange({ [key]: !danmaku[key] })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between gap-2">
        <span>显示弹幕 (D)</span>
        <input
          type="checkbox"
          checked={danmaku.enabled}
          onChange={(e) => onDanmakuChange({ enabled: e.target.checked })}
        />
      </label>

      <RangeRow
        label="透明度"
        value={danmaku.opacity}
        min={0.1}
        max={1}
        step={0.05}
        display={`${Math.round(danmaku.opacity * 100)}%`}
        onChange={(v) => onDanmakuChange({ opacity: v })}
        compact={false}
      />
      <RangeRow
        label="字号"
        value={danmaku.fontSize}
        min={0.5}
        max={2}
        step={0.05}
        display={`${danmaku.fontSize.toFixed(2)}×`}
        onChange={(v) => onDanmakuChange({ fontSize: v })}
        compact={false}
      />
      <RangeRow
        label="速度"
        value={danmaku.speed}
        min={0.5}
        max={2}
        step={0.05}
        display={`${danmaku.speed.toFixed(2)}×`}
        onChange={(v) => onDanmakuChange({ speed: v })}
        compact={false}
      />
      <RangeRow
        label="显示区域"
        value={danmaku.area}
        min={0.2}
        max={1}
        step={0.05}
        display={`${Math.round(danmaku.area * 100)}%`}
        onChange={(v) => onDanmakuChange({ area: v })}
        compact={false}
      />
      <label className="flex items-center justify-between gap-2">
        <span>时间偏移 (秒)</span>
        <input
          type="number"
          step={0.5}
          value={danmaku.timeOffset}
          onChange={(e) =>
            onDanmakuChange({ timeOffset: Number(e.target.value) || 0 })
          }
          className="w-20 rounded-lg border border-[var(--kz-border)] bg-[var(--kz-bg)] px-2 py-1 text-right text-sm"
        />
      </label>

      <div className="flex flex-wrap gap-3 text-xs text-[var(--kz-fg)]">
        {(
          [
            ['showScroll', '滚动'],
            ['showTop', '顶部'],
            ['showBottom', '底部'],
            ['showColor', '彩色'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={danmaku[key]}
              onChange={(e) => onDanmakuChange({ [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  )
}

function ImportTab({ compact, ...props }: Props & { compact: boolean }) {
  if (compact) {
    return (
      <div className="kz-dm-form">
        <div className="kz-dm-section">
          <div className="kz-dm-label">B 站 BV / 链接</div>
          <input
            className="kz-dm-input"
            value={props.bvInput}
            onChange={(e) => props.onBvInputChange(e.target.value)}
            placeholder="BV1… 或完整链接"
            onKeyDown={(e) => {
              if (e.key === 'Enter') props.onLoadBilibili()
            }}
          />
          <div className="kz-dm-row">
            <label className="kz-dm-inline-num kz-dm-inline-num--grow">
              <span>分P</span>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={props.bvPage}
                onChange={(e) =>
                  props.onBvPageChange(Math.max(1, Number(e.target.value) || 1))
                }
                className="kz-dm-num"
              />
            </label>
            <button
              type="button"
              disabled={props.bilibiliBusy}
              onClick={props.onLoadBilibili}
              className="kz-dm-btn-primary"
            >
              {props.bilibiliBusy ? '拉取中…' : '追加 B 站'}
            </button>
          </div>
        </div>

        <button type="button" onClick={props.onPickXmlFile} className="kz-dm-file-btn">
          选择 XML 弹幕文件
          <span className="kz-dm-hint">B 站 / pakku · 默认追加</span>
        </button>

        <div className="kz-dm-section kz-dm-section--border">
          <div className="kz-dm-label">
            屏蔽词 · {props.danmaku.filters.length} 条
          </div>
          <div className="kz-dm-row">
            <input
              className="kz-dm-input"
              value={props.filterDraft}
              onChange={(e) => props.onFilterDraftChange(e.target.value)}
              placeholder="关键词 或 /regex/"
              onKeyDown={(e) => {
                if (e.key === 'Enter') props.onAddFilter()
              }}
            />
            <button type="button" onClick={props.onAddFilter} className="kz-dm-btn-ghost">
              添加
            </button>
          </div>
          {props.danmaku.filters.length > 0 && (
            <ul className="kz-dm-filter-list">
              {props.danmaku.filters.map((rule) => (
                <li key={rule} className="kz-dm-filter-item">
                  <span className="kz-dm-filter-rule">{rule}</span>
                  <button
                    type="button"
                    className="kz-dm-filter-del"
                    onClick={() => props.onRemoveFilter(rule)}
                  >
                    删
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="text-xs text-[var(--kz-fg-muted)]">Bilibili BV 号 / 链接</div>
        <input
          className="w-full rounded-lg border border-[var(--kz-border)] bg-[var(--kz-bg)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--kz-accent)]"
          value={props.bvInput}
          onChange={(e) => props.onBvInputChange(e.target.value)}
          placeholder="BV1… 或完整视频链接"
          onKeyDown={(e) => {
            if (e.key === 'Enter') props.onLoadBilibili()
          }}
        />
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-[var(--kz-fg-muted)]">
            分P
            <input
              type="number"
              min={1}
              value={props.bvPage}
              onChange={(e) =>
                props.onBvPageChange(Math.max(1, Number(e.target.value) || 1))
              }
              className="w-14 rounded-lg border border-[var(--kz-border)] bg-[var(--kz-bg)] px-2 py-1 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={props.bilibiliBusy}
            onClick={props.onLoadBilibili}
            className="rounded-lg bg-[var(--kz-accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--kz-accent-hover)] disabled:opacity-50"
          >
            {props.bilibiliBusy ? '拉取中…' : '追加 B 站弹幕'}
          </button>
        </div>
        <p className="text-[11px] text-[var(--kz-fg-muted)]">
          默认追加到现有弹幕，不会清空弹弹源。
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="text-xs text-[var(--kz-fg-muted)]">本地弹幕文件</div>
        <button
          type="button"
          onClick={props.onPickXmlFile}
          className="w-full rounded-lg border border-dashed border-[var(--kz-border)] bg-[var(--kz-bg-elevated)] px-3 py-3 text-xs text-[var(--kz-fg)] hover:border-[var(--kz-accent)] hover:text-[var(--kz-accent)]"
        >
          选择 XML（B 站 / pakku 导出）
          <div className="mt-1 text-[11px] text-[var(--kz-fg-muted)]">
            默认追加 · 也可把 .xml 拖到播放器上
          </div>
        </button>
      </div>

      <div className="space-y-1.5 border-t border-[var(--kz-border)] pt-2">
        <div className="text-xs text-[var(--kz-fg-muted)]">
          屏蔽词（支持 /正则/）· {props.danmaku.filters.length} 条
        </div>
        <div className="flex gap-2">
          <input
            className="w-full rounded-lg border border-[var(--kz-border)] bg-[var(--kz-bg)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--kz-accent)]"
            value={props.filterDraft}
            onChange={(e) => props.onFilterDraftChange(e.target.value)}
            placeholder="关键词 或 /regex/"
            onKeyDown={(e) => {
              if (e.key === 'Enter') props.onAddFilter()
            }}
          />
          <button
            type="button"
            onClick={props.onAddFilter}
            className="shrink-0 rounded-lg bg-[var(--kz-bg-soft)] px-3 py-1.5 text-xs hover:bg-[var(--kz-bg-soft)]"
          >
            添加
          </button>
        </div>
        {props.danmaku.filters.length > 0 && (
          <ul className="max-h-28 space-y-1 overflow-y-auto">
            {props.danmaku.filters.map((rule) => (
              <li
                key={rule}
                className="flex items-center justify-between gap-2 rounded-md bg-[var(--kz-bg-elevated)] px-2 py-1 text-xs"
              >
                <span className="truncate font-mono text-[var(--kz-fg)]">{rule}</span>
                <button
                  type="button"
                  className="text-red-400 hover:text-red-300"
                  onClick={() => props.onRemoveFilter(rule)}
                >
                  删
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function RangeRow({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  compact,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (v: number) => void
  compact: boolean
}) {
  if (compact) {
    return (
      <label className="kz-dm-range">
        <div className="kz-dm-range-meta">
          <span>{label}</span>
          <span className="kz-dm-range-val">{display}</span>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="kz-dm-range-input"
        />
      </label>
    )
  }

  return (
    <label className="block space-y-1">
      <div className="flex justify-between text-xs text-[var(--kz-fg-muted)]">
        <span>{label}</span>
        <span className="tabular-nums text-[var(--kz-fg)]">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--kz-bg-soft)] accent-[var(--kz-accent)]"
      />
    </label>
  )
}
