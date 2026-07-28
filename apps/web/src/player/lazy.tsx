import { lazy, Suspense, type ComponentProps } from 'react'

/**
 * Lazy player chrome — keeps danmaku / hls / VideoPlayer out of light routes
 * until Play / Subject actually mount them.
 *
 * preload* only triggers dynamic import() (download + parse module graph).
 * It does NOT construct Hls, canvas danmaku, or mount <video>.
 */
const videoPlayerImport = () =>
  import('./VideoPlayer').then((m) => ({ default: m.VideoPlayer }))

const embedPlayerImport = () =>
  import('./EmbedPlayer').then((m) => ({ default: m.EmbedPlayer }))

export const LazyVideoPlayer = lazy(videoPlayerImport)
export const LazyEmbedPlayer = lazy(embedPlayerImport)

let videoPlayerPreload: Promise<unknown> | null = null
let embedPlayerPreload: Promise<unknown> | null = null

/** Idempotent — safe on every card hover / watch mount. */
export function preloadVideoPlayer(): void {
  if (videoPlayerPreload) return
  videoPlayerPreload = videoPlayerImport().catch(() => {
    // Allow retry after a failed network attempt
    videoPlayerPreload = null
  })
}

export function preloadEmbedPlayer(): void {
  if (embedPlayerPreload) return
  embedPlayerPreload = embedPlayerImport().catch(() => {
    embedPlayerPreload = null
  })
}

function PlayerFallback({ text }: { text: string }) {
  return (
    <div className="kz-player-placeholder text-sm text-[var(--kz-fg)]">
      {text}
    </div>
  )
}

export function VideoPlayerSuspense(
  props: ComponentProps<typeof LazyVideoPlayer>,
) {
  return (
    <Suspense fallback={<PlayerFallback text="加载播放器…" />}>
      <LazyVideoPlayer {...props} />
    </Suspense>
  )
}

export function EmbedPlayerSuspense(
  props: ComponentProps<typeof LazyEmbedPlayer>,
) {
  return (
    <Suspense fallback={<PlayerFallback text="加载嵌入播放器…" />}>
      <LazyEmbedPlayer {...props} />
    </Suspense>
  )
}
