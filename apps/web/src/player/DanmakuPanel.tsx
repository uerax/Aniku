import type {
  DanmakuAnime,
  DanmakuEpisode,
  DanmakuSettings,
} from '@aniku/shared'
import type { DanmakuSourceChip } from '../lib/danmaku-pools'
import type { DanmakuPoolId } from '../lib/danmaku-pools'

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
  /** Bottom offset so panel sits above player controls */
  bottomOffset?: number
}

const tabBtn =
  'rounded-md px-2.5 py-1 text-xs transition-colors data-[active=true]:bg-sky-600 data-[active=true]:text-white data-[active=false]:text-zinc-300 data-[active=false]:hover:bg-zinc-700'

const field =
  'w-full rounded-lg border border-zinc-700 bg-zinc-950/90 px-2.5 py-1.5 text-sm outline-none focus:border-sky-600'

const rangeClass =
  'h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-700 accent-sky-500'

export function DanmakuPanel(props: Props) {
  if (!props.open) return null

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
      className="absolute right-2 z-[60] w-[min(22rem,calc(100%-1rem))] overflow-hidden rounded-xl border border-zinc-600/90 bg-zinc-950/98 shadow-2xl backdrop-blur-md"
      style={{ bottom: bottomOffset }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="弹幕面板"
    >
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <div className="flex gap-1">
          {(
            [
              ['search', '搜索'],
              ['settings', '设置'],
              ['import', '导入'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              data-active={tab === id}
              className={tabBtn}
              onClick={() => onTabChange(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="关闭弹幕面板"
        >
          ✕
        </button>
      </div>

      <div className="max-h-[min(22rem,50vh)] space-y-3 overflow-y-auto p-3 text-sm">
        <div className="text-xs text-zinc-400">
          {status || '—'}
          {commentsCount > 0 ? (
            <span className="ml-2 text-sky-400/90">
              · 共 {commentsCount} 条
              {shown !== commentsCount ? ` · 显示 ${shown}` : ''}
            </span>
          ) : null}
        </div>

        {tab === 'search' && <SearchTab {...props} />}
        {tab === 'settings' && (
          <SettingsTab danmaku={danmaku} onDanmakuChange={onDanmakuChange} />
        )}
        {tab === 'import' && <ImportTab {...props} />}
      </div>

      {sources && sources.some((s) => s.loaded) && onToggleSource ? (
        <div className="border-t border-zinc-800 px-3 py-2">
          <div className="mb-1.5 text-[11px] text-zinc-500">
            弹幕源 · 亮色显示 / 灰色关闭
          </div>
          <div className="flex flex-wrap gap-1.5">
            {sources
              .filter((s) => s.loaded)
              .map((s) => (
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
                      ? 'rounded-full bg-sky-600/90 px-2.5 py-1 text-[11px] font-medium text-white shadow-sm ring-1 ring-sky-400/40 hover:bg-sky-500'
                      : 'rounded-full bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-500 ring-1 ring-zinc-700 hover:bg-zinc-700 hover:text-zinc-300'
                  }
                >
                  {s.label}
                  <span className="ml-1 opacity-80">{s.count}</span>
                </button>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SearchTab(props: Props) {
  return (
    <div className="space-y-2.5">
      <label className="block space-y-1">
        <span className="text-xs text-zinc-500">弹弹play 番名</span>
        <div className="flex gap-2">
          <input
            className={field}
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
            className="shrink-0 rounded-lg bg-sky-600 px-3 py-1.5 text-xs hover:bg-sky-500 disabled:opacity-50"
          >
            {props.searchBusy ? '…' : '搜索'}
          </button>
        </div>
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-zinc-500">番剧</span>
        <select
          className={field}
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
        <span className="text-xs text-zinc-500">章节</span>
        <select
          className={field}
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

      <p className="text-[11px] leading-relaxed text-zinc-500">
        弹弹play 匹配会写入「弹弹」源。B 站 / XML 导入默认追加，不会覆盖弹弹；可在面板底部开关各源。
      </p>
    </div>
  )
}

function SettingsTab({
  danmaku,
  onDanmakuChange,
}: {
  danmaku: DanmakuSettings
  onDanmakuChange: (partial: Partial<DanmakuSettings>) => void
}) {
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
      />
      <RangeRow
        label="字号"
        value={danmaku.fontSize}
        min={0.5}
        max={2}
        step={0.05}
        display={`${danmaku.fontSize.toFixed(2)}×`}
        onChange={(v) => onDanmakuChange({ fontSize: v })}
      />
      <RangeRow
        label="速度"
        value={danmaku.speed}
        min={0.5}
        max={2}
        step={0.05}
        display={`${danmaku.speed.toFixed(2)}×`}
        onChange={(v) => onDanmakuChange({ speed: v })}
      />
      <RangeRow
        label="显示区域"
        value={danmaku.area}
        min={0.2}
        max={1}
        step={0.05}
        display={`${Math.round(danmaku.area * 100)}%`}
        onChange={(v) => onDanmakuChange({ area: v })}
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
          className="w-20 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-right text-sm"
        />
      </label>

      <div className="flex flex-wrap gap-3 text-xs text-zinc-300">
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

function ImportTab(props: Props) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="text-xs text-zinc-500">Bilibili BV 号 / 链接</div>
        <input
          className={field}
          value={props.bvInput}
          onChange={(e) => props.onBvInputChange(e.target.value)}
          placeholder="BV1… 或完整视频链接"
          onKeyDown={(e) => {
            if (e.key === 'Enter') props.onLoadBilibili()
          }}
        />
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-zinc-400">
            分P
            <input
              type="number"
              min={1}
              value={props.bvPage}
              onChange={(e) =>
                props.onBvPageChange(Math.max(1, Number(e.target.value) || 1))
              }
              className="w-14 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={props.bilibiliBusy}
            onClick={props.onLoadBilibili}
            className="rounded-lg bg-pink-600 px-3 py-1.5 text-xs hover:bg-pink-500 disabled:opacity-50"
          >
            {props.bilibiliBusy ? '拉取中…' : '追加 B 站弹幕'}
          </button>
        </div>
        <p className="text-[11px] text-zinc-500">
          默认追加到现有弹幕，不会清空弹弹源。
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="text-xs text-zinc-500">本地弹幕文件</div>
        <button
          type="button"
          onClick={props.onPickXmlFile}
          className="w-full rounded-lg border border-dashed border-zinc-600 bg-zinc-900/50 px-3 py-3 text-xs text-zinc-300 hover:border-sky-600 hover:text-sky-300"
        >
          选择 XML（B 站 / pakku 导出）
          <div className="mt-1 text-[11px] text-zinc-500">
            默认追加 · 也可把 .xml 拖到播放器上
          </div>
        </button>
      </div>

      <div className="space-y-1.5 border-t border-zinc-800 pt-2">
        <div className="text-xs text-zinc-500">
          屏蔽词（支持 /正则/）· {props.danmaku.filters.length} 条
        </div>
        <div className="flex gap-2">
          <input
            className={field}
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
            className="shrink-0 rounded-lg bg-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-600"
          >
            添加
          </button>
        </div>
        {props.danmaku.filters.length > 0 && (
          <ul className="max-h-28 space-y-1 overflow-y-auto">
            {props.danmaku.filters.map((rule) => (
              <li
                key={rule}
                className="flex items-center justify-between gap-2 rounded-md bg-zinc-900 px-2 py-1 text-xs"
              >
                <span className="truncate font-mono text-zinc-300">{rule}</span>
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
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (v: number) => void
}) {
  return (
    <label className="block space-y-1">
      <div className="flex justify-between text-xs text-zinc-400">
        <span>{label}</span>
        <span className="tabular-nums text-zinc-300">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={rangeClass}
      />
    </label>
  )
}
