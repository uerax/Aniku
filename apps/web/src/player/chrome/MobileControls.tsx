import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type SyntheticEvent,
} from 'react'
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
  IconVolume,
  IconVolumeMute,
  IconWebFs,
  IconWebFsExit,
} from './icons'

type PopupPos = { left: number; bottom: number }

function placeAboveButton(btn: HTMLElement | null): PopupPos | null {
  if (!btn) return null
  const r = btn.getBoundingClientRect()
  return {
    left: r.left + r.width / 2,
    // viewport bottom → button top + gap (keeps menu above control)
    bottom: Math.max(8, window.innerHeight - r.top + 8),
  }
}

function fixedPopupStyle(pos: PopupPos): CSSProperties {
  return {
    position: 'fixed',
    left: pos.left,
    bottom: pos.bottom,
    top: 'auto',
    right: 'auto',
    transform: 'translateX(-50%)',
  }
}

/**
 * Mobile / touch control bar.
 * Menus (speed / SR / volume) use position:fixed popups so they are not clipped
 * by .kz-bar-row { overflow-x:auto; overflow-y:hidden } on narrow screens.
 */
export function MobileControls(props: PlayerControlsProps) {
  const {
    showBar,
    paused,
    panelOpen,
    speedMenuOpen,
    srMenuOpen,
    volumeMenuOpen,
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
    onToggleVolumeMenu,
    onPickSpeed,
    onPickSr,
    onVolume,
    onTogglePlayerFs,
    onToggleWebFs,
    formatTime,
    speedOptions,
    srLabels,
  } = props

  const pinBar =
    showBar ||
    paused ||
    panelOpen ||
    srMenuOpen ||
    speedMenuOpen ||
    volumeMenuOpen

  const vol = player.volume ?? 0.7
  const volPct = Math.round(Math.min(1, Math.max(0, vol)) * 100)

  const speedBtnRef = useRef<HTMLButtonElement>(null)
  const srBtnRef = useRef<HTMLButtonElement>(null)
  const volBtnRef = useRef<HTMLButtonElement>(null)

  const [speedPos, setSpeedPos] = useState<PopupPos | null>(null)
  const [srPos, setSrPos] = useState<PopupPos | null>(null)
  const [volPos, setVolPos] = useState<PopupPos | null>(null)

  const reposition = () => {
    if (speedMenuOpen) setSpeedPos(placeAboveButton(speedBtnRef.current))
    if (srMenuOpen) setSrPos(placeAboveButton(srBtnRef.current))
    if (volumeMenuOpen) setVolPos(placeAboveButton(volBtnRef.current))
  }

  useLayoutEffect(() => {
    if (!speedMenuOpen) setSpeedPos(null)
    else setSpeedPos(placeAboveButton(speedBtnRef.current))
  }, [speedMenuOpen, showBar, pinBar])

  useLayoutEffect(() => {
    if (!srMenuOpen) setSrPos(null)
    else setSrPos(placeAboveButton(srBtnRef.current))
  }, [srMenuOpen, showBar, pinBar])

  useLayoutEffect(() => {
    if (!volumeMenuOpen) setVolPos(null)
    else setVolPos(placeAboveButton(volBtnRef.current))
  }, [volumeMenuOpen, showBar, pinBar])

  useEffect(() => {
    const anyOpen = speedMenuOpen || srMenuOpen || volumeMenuOpen
    if (!anyOpen) return
    const onReposition = () => reposition()
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speedMenuOpen, srMenuOpen, volumeMenuOpen])

  const stop = (e: SyntheticEvent) => e.stopPropagation()

  return (
    <div
      className={`kz-bar ${pinBar ? 'kz-bar--show' : ''}`}
      onMouseDown={stop}
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

          {/* Speed — button stays in bar; menu is fixed portal-like sibling */}
          <div className="kz-speed-wrap">
            <button
              ref={speedBtnRef}
              type="button"
              className="kz-ctrl"
              data-active={speedMenuOpen}
              onClick={(e) => {
                e.stopPropagation()
                onToggleSpeedMenu()
              }}
              aria-expanded={speedMenuOpen}
            >
              {player.speed || 1}x
            </button>
          </div>

          {/* Super-resolution */}
          <div className="kz-speed-wrap kz-sr-wrap">
            <button
              ref={srBtnRef}
              type="button"
              className="kz-ctrl"
              data-active={srMode !== 'off' || srMenuOpen}
              onClick={(e) => {
                e.stopPropagation()
                onToggleSrMenu()
              }}
              title={
                webGpuOk === false
                  ? '当前浏览器不支持 WebGPU 超分'
                  : srMode === 'off'
                    ? '超分'
                    : `超分：${srLabels[srMode]}`
              }
              aria-expanded={srMenuOpen}
            >
              {srMode === 'off'
                ? '超分'
                : `${srLabels[srMode]}${srActive ? '' : '…'}`}
            </button>
          </div>

          {/* Volume */}
          <div className="kz-vol-popup-wrap">
            <button
              ref={volBtnRef}
              type="button"
              className="kz-ctrl kz-ctrl-icon"
              data-active={volumeMenuOpen || volPct === 0}
              onClick={(e) => {
                e.stopPropagation()
                onToggleVolumeMenu()
              }}
              title="音量"
              aria-label="音量"
              aria-expanded={volumeMenuOpen}
            >
              {volPct === 0 ? <IconVolumeMute /> : <IconVolume />}
            </button>
          </div>

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

      {/* Fixed menus — outside .kz-bar-row overflow clip */}
      {speedMenuOpen && speedPos && (
        <div
          className="kz-speed-menu kz-mobile-fixed-menu"
          data-player-chrome
          style={fixedPopupStyle(speedPos)}
          onMouseDown={stop}
          onClick={stop}
          onPointerDown={stop}
        >
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

      {srMenuOpen && srPos && (
        <div
          className="kz-speed-menu kz-mobile-fixed-menu"
          data-player-chrome
          style={fixedPopupStyle(srPos)}
          onMouseDown={stop}
          onClick={stop}
          onPointerDown={stop}
        >
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

      {volumeMenuOpen && volPos && (
        <div
          className="kz-vol-popup"
          data-player-chrome
          style={fixedPopupStyle(volPos)}
          onMouseDown={stop}
          onClick={stop}
          onPointerDown={stop}
        >
          <span className="kz-vol-popup-label tabular-nums">{volPct}</span>
          <div className="kz-vol-popup-track">
            <div
              className="kz-vol-popup-fill"
              style={{ height: `${volPct}%` }}
              aria-hidden
            />
            <input
              type="range"
              className="kz-vol-popup-range"
              min={0}
              max={100}
              value={volPct}
              onChange={(e) => onVolume(Number(e.target.value) / 100)}
              aria-label="音量"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={volPct}
            />
          </div>
        </div>
      )}
    </div>
  )
}
