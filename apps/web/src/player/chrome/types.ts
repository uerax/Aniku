import type { PlayerSettings, SuperResolutionMode } from '@aniku/shared'

/**
 * Control-bar props bag — display state + callbacks only.
 * No media engine refs (video/hls/danmaku core).
 */
export interface PlayerControlsProps {
  showBar: boolean
  paused: boolean
  panelOpen: boolean
  speedMenuOpen: boolean
  srMenuOpen: boolean
  current: number
  duration: number
  progress: number
  danmakuEnabled: boolean
  hasDanmakuPanel: boolean
  player: PlayerSettings
  srMode: SuperResolutionMode
  srActive: boolean
  webGpuOk: boolean | null
  playerFs: boolean
  webFs: boolean
  onTogglePlay: () => void
  onPrev?: () => void
  onNext?: () => void
  onSeekRatio: (ratio: number) => void
  onToggleDanmaku?: () => void
  onTogglePanel: () => void
  onToggleSpeedMenu: () => void
  onToggleSrMenu: () => void
  onPickSpeed: (speed: number) => void
  onPickSr: (mode: SuperResolutionMode) => void
  onVolume: (vol: number) => void
  onTogglePlayerFs: () => void
  onToggleWebFs: () => void
  formatTime: (sec: number) => string
  speedOptions: readonly number[]
  srLabels: Record<SuperResolutionMode, string>
}
