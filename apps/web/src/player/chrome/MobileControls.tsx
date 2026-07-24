import type { SuperResolutionMode } from '@aniku/shared'
import type { PlayerControlsProps } from './types'
import {
  IconFullscreen,
  IconFullscreenExit,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconSettings,
  IconWebFs,
  IconWebFsExit,
} from './icons'

/**
 * Mobile / touch control bar.
 * - No volume rail in markup (hardware volume; CSS also hides .kz-vol-wrap ≤720px)
 * - Layout density still refined by plyr-overrides.css @media queries
 * Interaction (tap/double-tap) lives in useShellPointerHandlers.
 */
export function MobileControls(props: PlayerControlsProps) {
  const {
    showBar,
    paused,
    panelOpen,
    speedMenuOpen,
    srMenuOpen,
    current,
    duration,
    progress,
    danmakuEnabled,
    hasDanmakuPanel,
    player,
    srMode,
    srActive,
    webGpuOk,
    playerFs,
    webFs,
    onTogglePlay,
    onPrev,
    onNext,
    onSeekRatio,
    onToggleDanmaku,
    onTogglePanel,
    onToggleSpeedMenu,
    onToggleSrMenu,
    onPickSpeed,
    onPickSr,
    onTogglePlayerFs,
    onToggleWebFs,
    formatTime,
    speedOptions,
    srLabels,
  } = props

  const pinBar = showBar || paused || panelOpen || srMenuOpen || speedMenuOpen

  return (
    <div
      className={`kz-bar ${pinBar ? 'kz-bar--show' : ''}`}
      onMouseDown={(e) => e.stopPropagation()}
      data-player-chrome
    >
      <input
        type="range"
        className="kz-seek"
        min={0}
        max={1000}
        value={Math.round(progress * 10)}
        onChange={(e) => onSeekRatio(Number(e.target.value) / 1000)}
        style={{ ['--kz-progress' as string]: `${progress}%` }}
        aria-label="进度"
      />
      <div className="kz-bar-row">
        <div className="kz-bar-left">
          <button
            type="button"
            className="kz-ctrl kz-ctrl-icon"
            onClick={onTogglePlay}
            title={paused ? '播放' : '暂停'}
            aria-label={paused ? '播放' : '暂停'}
          >
            {paused ? <IconPlay /> : <IconPause />}
          </button>
          <button
            type="button"
            className="kz-ctrl kz-ctrl-icon"
            onClick={() => onPrev?.()}
            title="上一集"
            aria-label="上一集"
          >
            <IconPrev />
          </button>
          <button
            type="button"
            className="kz-ctrl kz-ctrl-icon"
            onClick={() => onNext?.()}
            title="下一集"
            aria-label="下一集"
          >
            <IconNext />
          </button>
          <span className="kz-time">
            {formatTime(current)} / {formatTime(duration)}
          </span>
        </div>
        <div className="kz-bar-right">
          <button
            type="button"
            className="kz-ctrl"
            data-active={danmakuEnabled}
            onClick={() => onToggleDanmaku?.()}
            title="弹幕开关"
          >
            {danmakuEnabled ? '弹' : '关'}
          </button>
          {hasDanmakuPanel && (
            <button
              type="button"
              className="kz-ctrl kz-ctrl-icon"
              data-active={panelOpen}
              onClick={onTogglePanel}
              title="弹幕设置"
              aria-label="设置"
            >
              <IconSettings />
            </button>
          )}
          <div className="kz-speed-wrap">
            <button type="button" className="kz-ctrl" onClick={onToggleSpeedMenu}>
              {player.speed || 1}x
            </button>
            {speedMenuOpen && (
              <div className="kz-speed-menu">
                {[...speedOptions].reverse().map((s) => (
                  <button
                    key={s}
                    type="button"
                    data-active={Math.abs((player.speed || 1) - s) < 0.01}
                    onClick={() => onPickSpeed(s)}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="kz-speed-wrap kz-sr-wrap">
            <button
              type="button"
              className="kz-ctrl"
              data-active={srMode !== 'off'}
              onClick={onToggleSrMenu}
              title={
                webGpuOk === false
                  ? '当前浏览器不支持 WebGPU 超分'
                  : srMode === 'off'
                    ? '超分'
                    : `超分：${srLabels[srMode]}`
              }
            >
              {srMode === 'off'
                ? '超分'
                : `${srLabels[srMode]}${srActive ? '' : '…'}`}
            </button>
            {srMenuOpen && (
              <div className="kz-speed-menu">
                {webGpuOk === false && (
                  <div
                    className="px-2 py-1.5 text-[11px] leading-snug text-amber-200/90"
                    style={{ maxWidth: '12rem' }}
                  >
                    {typeof window !== 'undefined' && !window.isSecureContext
                      ? 'WebGPU 需 HTTPS 或 localhost'
                      : '当前环境无 WebGPU'}
                  </div>
                )}
                {(['off', 'efficiency', 'quality'] as SuperResolutionMode[]).map(
                  (m) => (
                    <button
                      key={m}
                      type="button"
                      data-active={srMode === m}
                      onClick={() => onPickSr(m)}
                    >
                      {srLabels[m]}
                      {m === srMode && srActive && m !== 'off' ? ' ✓' : ''}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
          {/* Volume omitted on mobile — hardware volume; CSS also hides .kz-vol-wrap */}
          <button
            type="button"
            className="kz-ctrl kz-ctrl-icon kz-ctrl-fs"
            data-active={playerFs || webFs}
            onClick={onTogglePlayerFs}
            title="全屏"
            aria-label={playerFs || webFs ? '退出全屏' : '全屏'}
          >
            {playerFs || webFs ? <IconFullscreenExit /> : <IconFullscreen />}
            <span className="kz-ctrl-label">
              {playerFs || webFs ? '退出' : '全屏'}
            </span>
          </button>
          <button
            type="button"
            className="kz-ctrl kz-ctrl-icon kz-ctrl-web-fs"
            data-active={webFs}
            onClick={onToggleWebFs}
            title="网页全屏"
            aria-label={webFs ? '退出网页全屏' : '网页全屏'}
          >
            {webFs ? <IconWebFsExit /> : <IconWebFs />}
            <span className="kz-ctrl-label kz-ctrl-label-web-fs">
              {webFs ? '退出网页' : '网页全屏'}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
