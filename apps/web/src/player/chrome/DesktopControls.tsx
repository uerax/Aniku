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
 * Desktop control bar — full volume rail + FS labels.
 * Interaction (hover/click) lives in useShellPointerHandlers; this is markup only.
 */
export function DesktopControls(props: PlayerControlsProps) {
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
    onVolume,
    onTogglePlayerFs,
    onToggleWebFs,
    formatTime,
    speedOptions,
    srLabels,
  } = props
  // volumeMenuOpen / onToggleVolumeMenu are mobile-only (icon + vertical popup)

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
            title="上一集 (P)"
            aria-label="上一集"
          >
            <IconPrev />
          </button>
          <button
            type="button"
            className="kz-ctrl kz-ctrl-icon"
            onClick={() => onNext?.()}
            title="下一集 (N)"
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
            title="弹幕开关 (D)"
          >
            {danmakuEnabled ? '弹' : '关'}
          </button>
          {hasDanmakuPanel && (
            <button
              type="button"
              className="kz-ctrl kz-ctrl-icon"
              data-active={panelOpen}
              onClick={onTogglePanel}
              title="弹幕设置 (Alt+M)"
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
              title={srTitle(webGpuOk, srMode, srActive, srLabels)}
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
                      ? 'WebGPU 需 HTTPS 或 localhost；用局域网 IP 的 HTTP 访问时不可用'
                      : '当前环境无 WebGPU，选档会提示失败'}
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
          <div className="kz-vol-wrap">
            <div className="kz-vol-rail" aria-hidden>
              <div
                className="kz-vol-fill"
                style={{
                  width: `${Math.round((player.volume ?? 0.7) * 100)}%`,
                }}
              />
            </div>
            <input
              type="range"
              className="kz-vol"
              min={0}
              max={100}
              value={Math.round((player.volume ?? 0.7) * 100)}
              onChange={(e) => onVolume(Number(e.target.value) / 100)}
              aria-label="音量"
            />
          </div>
          <button
            type="button"
            className="kz-ctrl kz-ctrl-icon kz-ctrl-fs"
            data-active={playerFs || webFs}
            onClick={onTogglePlayerFs}
            title="全屏（iPhone 为系统视频全屏；其它环境为播放器/网页全屏）"
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
            title="网页全屏（铺满视口；iOS 上可作无 API 时的替代）"
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

function srTitle(
  webGpuOk: boolean | null,
  srMode: SuperResolutionMode,
  srActive: boolean,
  srLabels: Record<SuperResolutionMode, string>,
): string {
  if (webGpuOk === false) {
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      return '超分需要安全上下文（HTTPS 或 localhost）。当前为 HTTP 远程访问，WebGPU 不可用'
    }
    return '当前浏览器不支持 WebGPU 超分'
  }
  if (srMode === 'off') return '超分（Anime4K，默认关；需 WebGPU）'
  return `超分：${srLabels[srMode]}${srActive ? ' · 已生效' : ' · 启动中…'}`
}
