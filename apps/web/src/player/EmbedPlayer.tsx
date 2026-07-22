/**
 * Fallback when static resolve cannot extract m3u8/mp4:
 * embed the source play page so the site's own JS player can run in the browser.
 *
 * Limits (not the same as desktop WebView intercept):
 * - Many sites set X-Frame-Options / CSP frame-ancestors → blank iframe
 * - Cross-origin: we cannot read media URL or hook timeupdate for danmaku sync
 * - Danmaku overlay still works on our side only if we had a native media element
 */

interface Props {
  pageUrl: string
  title?: string
  reason?: string
  onRetryResolve?: () => void
}

export function EmbedPlayer({
  pageUrl,
  title,
  reason,
  onRetryResolve,
}: Props) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-black">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-amber-950/40 px-3 py-2 text-xs text-amber-100/90">
        <div className="min-w-0 flex-1 leading-relaxed">
          <span className="font-medium text-amber-200">iframe 源站播放</span>
          <span className="text-amber-100/70">
            {' '}
            · 静态解析未拿到直链，改嵌源站页面（浏览器内跑 JS）。若画面空白，多半被源站禁止嵌入。
          </span>
          {reason ? (
            <div className="mt-1 line-clamp-2 text-[11px] text-amber-100/50">
              {reason}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          {onRetryResolve && (
            <button
              type="button"
              onClick={onRetryResolve}
              className="rounded-md bg-zinc-800 px-2.5 py-1 text-zinc-200 hover:bg-zinc-700"
            >
              重试直链
            </button>
          )}
          <a
            href={pageUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-sky-700 px-2.5 py-1 text-white hover:bg-sky-600"
          >
            新窗口打开
          </a>
        </div>
      </div>
      <div className="relative aspect-video w-full bg-black">
        <iframe
          title={title || '源站播放'}
          src={pageUrl}
          className="absolute inset-0 h-full w-full border-0"
          // allow video/fullscreen; sandbox loose enough for third-party players
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          referrerPolicy="no-referrer-when-downgrade"
          // Do NOT use sandbox that blocks scripts — source players need JS
        />
      </div>
      <div className="border-t border-zinc-800 px-3 py-2 text-[11px] leading-relaxed text-zinc-500">
        与桌面 Kazumi WebView 不同：跨域 iframe 无法拦截 m3u8，弹幕/续播/跳过片头在此模式下不可用。
        优先仍应换可静态解析的规则或线路。
      </div>
    </div>
  )
}
