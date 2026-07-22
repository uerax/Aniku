/** Playback prefs inspired by agefans-enhance KPlayer */

export interface SkipSegment {
  /** Whether auto-skip is active for this segment */
  enabled: boolean
  /** Start position in seconds (or mm:ss parsed to seconds) */
  start: number
  /** Seconds to skip forward from start */
  duration: number
}

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
}

export const PLAYER_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4] as const

export const defaultPlayerSettings: PlayerSettings = {
  speed: 1,
  autoplay: true,
  autoNext: true,
  continuePlay: true,
  customSeekTime: 85,
  volume: 1,
  skipOp: { enabled: false, start: 0, duration: 90 },
  skipEd: { enabled: false, start: 0, duration: 90 },
}
