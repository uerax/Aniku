import { Link } from 'react-router-dom'
import { useHistoryStore } from '../stores/history'
import { EmptyState, PageHeader } from '../components/ui'
import { EMPTY_ARRAY } from '../lib/stable'

function formatTime(sec: number) {
  if (!sec || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function HistoryPage() {
  const items = useHistoryStore((s) =>
    Array.isArray(s.items) ? s.items : EMPTY_ARRAY,
  )
  const remove = useHistoryStore((s) => s.remove)
  const clear = useHistoryStore((s) => s.clear)

  return (
    <div>
      <PageHeader
        title="观看历史"
        description="本地保存的播放进度（浏览器存储）"
        actions={
          items.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                if (confirm('清空全部观看历史？')) clear()
              }}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-900"
            >
              清空
            </button>
          ) : undefined
        }
      />
      {!items.length && <EmptyState text="暂无观看记录" />}
      <div className="space-y-2">
        {items.map((h) => {
          const pct =
            h.duration > 0
              ? Math.min(100, Math.round((h.position / h.duration) * 100))
              : 0
          const resumeQ = new URLSearchParams({
            plugin: h.pluginName,
            pageUrl: h.pageUrl,
            ep: String(h.episode),
            road: String(h.road),
            title: h.title,
            cover: h.cover || '',
          })
          return (
            <div
              key={h.id}
              className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3"
            >
              <Link
                to={`/subject/${h.bangumiId}`}
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                {h.cover ? (
                  <img
                    src={h.cover}
                    alt=""
                    className="h-16 w-12 rounded object-cover"
                  />
                ) : (
                  <div className="h-16 w-12 rounded bg-zinc-800" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{h.title}</div>
                  <div className="text-xs text-zinc-500">
                    {h.pluginName} · 第 {h.episode} 集 ·{' '}
                    {formatTime(h.position)}
                    {h.duration > 0 ? ` / ${formatTime(h.duration)}` : ''}
                  </div>
                  {h.duration > 0 && (
                    <div className="mt-1.5 h-1 overflow-hidden rounded bg-zinc-800">
                      <div
                        className="h-full bg-sky-600"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
              </Link>
              <div className="flex shrink-0 flex-col gap-1">
                <Link
                  to={`/play/${h.bangumiId}?${resumeQ}`}
                  className="rounded-lg px-2 py-1 text-xs text-sky-400 hover:bg-zinc-800"
                >
                  续播
                </Link>
                <button
                  type="button"
                  onClick={() => remove(h.id)}
                  className="rounded-lg px-2 py-1 text-xs text-red-400 hover:bg-zinc-800"
                >
                  删除
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
