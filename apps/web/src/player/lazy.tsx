import { lazy, Suspense, type ComponentProps } from 'react'

/**
 * Lazy player chrome — keeps danmaku / hls / VideoPlayer out of light routes
 * until Play / Subject actually mount them.
 */
export const LazyVideoPlayer = lazy(() =>
  import('./VideoPlayer').then((m) => ({ default: m.VideoPlayer })),
)

export const LazyEmbedPlayer = lazy(() =>
  import('./EmbedPlayer').then((m) => ({ default: m.EmbedPlayer })),
)

function PlayerFallback({ text }: { text: string }) {
  return (
    <div className="kz-player-placeholder text-sm text-zinc-300">{text}</div>
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
