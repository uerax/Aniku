/** Playback prefs inspired by agefans-enhance KPlayer */

export interface SkipSegment {
  /** Whether auto-skip is active for this segment */
  enabled: boolean
  /** Start position in seconds (or mm:ss parsed to seconds) */
  start: number
  /** Seconds to skip forward from start */
  duration: number
}

/** Real-time Anime4K super-resolution (WebGPU). Default off — zero GPU cost when off. */
export type SuperResolutionMode = 'off' | 'efficiency' | 'quality'

export interface PlayerSettings {
  /** Default playback rate */
  speed: number
  /** Auto-play when media is ready */
  autoplay: boolean
  /** When episode ends, go to next */
  autoNext: boolean
  /** Jump to last history position when opening an episode */
  continuePlay: boolean
  /** Custom seek step for J / Shift+J (seconds) */
  customSeekTime: number
  /** Last remembered volume 0–1 */
  volume: number
  /** Skip OP-like segment near the start */
  skipOp: SkipSegment
  /**
   * Skip ED: when start is 0, treat as "last N seconds of video"
   * (start + duration from end). When start > 0, skip [start, start+duration].
   */
  skipEd: SkipSegment
  /**
   * Anime4K super-resolution (browser WebGPU).
   * `off` — native video only (no GPU pipeline).
   * `efficiency` — lighter CNN restore + x2.
   * `quality` — ModeA-style heavier chain.
   */
  superResolution: SuperResolutionMode
  /**
   * Force HLS discontinuity ad-filter on all proxied m3u8
   * (ignores per-rule `adBlocker` when true). Kazumi: forceAdBlocker.
   */
  forceAdBlocker: boolean
  /**
   * Always play via `/api/media/proxy` instead of direct CDN.
   * Helps when the browser cannot reach source CDNs (poor network / geo / hotlink).
   * Search/chapters/resolve already go through the API; this only affects media.
   */
  forceMediaProxy: boolean
}

export const PLAYER_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4] as const

export const SUPER_RESOLUTION_MODES: readonly SuperResolutionMode[] = [
  'off',
  'efficiency',
  'quality',
] as const

export const defaultPlayerSettings: PlayerSettings = {
  speed: 1,
  autoplay: true,
  autoNext: true,
  continuePlay: true,
  customSeekTime: 85,
  volume: 1,
  skipOp: { enabled: false, start: 0, duration: 90 },
  skipEd: { enabled: false, start: 0, duration: 90 },
  superResolution: 'off',
  forceAdBlocker: false,
  forceMediaProxy: false,
}
