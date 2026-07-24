import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
} from 'react'
import type { PointerMode } from './usePointerMode'

export interface ShellPointerHandlerApi {
  togglePlay: () => void
  toggleFs: () => void
  bumpBar: () => void
  hideBar: () => void
  showBarRef: MutableRefObject<boolean>
  /** Close speed / SR menus if open; return true if something was closed. */
  closeMenus: () => boolean
  /** Close danmaku panel if open; return true if closed. */
  closePanel: () => boolean
  /** When false, desktop mouseleave keeps the bar (paused). */
  isPlaying: () => boolean
}

function isPlayerChromeTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el?.closest) return false
  return Boolean(
    el.closest(
      '.kz-bar, .kz-big-play, .kz-speed-menu, .kz-sr-menu, .kz-vol-popup, button, a, input, select, textarea, label, [role="dialog"], [data-player-chrome]',
    ),
  )
}

/** Max gap between taps to count as double-tap (mobile). */
const MOBILE_DOUBLE_TAP_MS = 300
/** Delay before treating a lone tap as chrome toggle. */
const MOBILE_SINGLE_TAP_DELAY_MS = 300

/**
 * Stage pointer handlers. Desktop and mobile policies live in separate branches
 * so edits to one path do not risk the other.
 *
 * Desktop (fine pointer):
 * - single-click play/pause; double-click fullscreen
 * - mouse enter/move show bar; leave hide while playing
 *
 * Mobile / touch:
 * - single-tap toggle chrome
 * - double-tap play/pause (timestamp-based — Safari often never fires dblclick)
 * - no hover path (synthetic mouse would fight tap toggle)
 */
export function useShellPointerHandlers(
  pointerMode: PointerMode,
  api: ShellPointerHandlerApi,
) {
  const apiRef = useRef(api)
  apiRef.current = api
  const shellClickTimerRef = useRef(0)
  /** Last stage tap time for mobile double-tap (dblclick is unreliable on iOS). */
  const lastTapAtRef = useRef(0)

  useEffect(() => {
    return () => window.clearTimeout(shellClickTimerRef.current)
  }, [])

  const onShellClick = useCallback(
    (e: ReactMouseEvent) => {
      if (isPlayerChromeTarget(e.target)) return
      const a = apiRef.current

      if (pointerMode === 'desktop') {
        window.clearTimeout(shellClickTimerRef.current)
        shellClickTimerRef.current = 0
        lastTapAtRef.current = 0
        if (a.closeMenus()) {
          a.bumpBar()
          return
        }
        if (a.closePanel()) {
          a.bumpBar()
          return
        }
        a.togglePlay()
        return
      }

      // Mobile: detect double-tap via timing (do not rely on onDoubleClick alone)
      const now = Date.now()
      const sinceLast = now - lastTapAtRef.current
      if (sinceLast > 0 && sinceLast < MOBILE_DOUBLE_TAP_MS) {
        window.clearTimeout(shellClickTimerRef.current)
        shellClickTimerRef.current = 0
        lastTapAtRef.current = 0
        a.togglePlay()
        return
      }
      lastTapAtRef.current = now

      // Single tap: wait in case a second tap arrives
      window.clearTimeout(shellClickTimerRef.current)
      shellClickTimerRef.current = window.setTimeout(() => {
        shellClickTimerRef.current = 0
        // Only clear lastTap if no second tap started a new window
        if (Date.now() - lastTapAtRef.current >= MOBILE_SINGLE_TAP_DELAY_MS - 20) {
          lastTapAtRef.current = 0
        }
        if (a.closeMenus()) {
          a.bumpBar()
          return
        }
        if (a.closePanel()) {
          a.bumpBar()
          return
        }
        if (a.showBarRef.current) a.hideBar()
        else a.bumpBar()
      }, MOBILE_SINGLE_TAP_DELAY_MS)
    },
    [pointerMode],
  )

  const onShellDoubleClick = useCallback(
    (e: ReactMouseEvent) => {
      if (isPlayerChromeTarget(e.target)) return
      e.preventDefault()
      window.clearTimeout(shellClickTimerRef.current)
      shellClickTimerRef.current = 0
      lastTapAtRef.current = 0
      const a = apiRef.current
      if (pointerMode === 'desktop') {
        a.toggleFs()
        return
      }
      // Fallback if browser still emits dblclick (desktop touch / some Androids)
      a.togglePlay()
    },
    [pointerMode],
  )

  const onShellMouseMove = useCallback(() => {
    if (pointerMode !== 'desktop') return
    apiRef.current.bumpBar()
  }, [pointerMode])

  const onShellMouseLeave = useCallback(() => {
    if (pointerMode !== 'desktop') return
    if (!apiRef.current.isPlaying()) return
    apiRef.current.hideBar()
  }, [pointerMode])

  const onShellMouseEnter = useCallback(() => {
    if (pointerMode !== 'desktop') return
    apiRef.current.bumpBar()
  }, [pointerMode])

  return {
    onShellClick,
    onShellDoubleClick,
    onShellMouseMove,
    onShellMouseLeave,
    onShellMouseEnter,
  }
}
