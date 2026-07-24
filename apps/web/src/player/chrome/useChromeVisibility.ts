import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import type { PointerMode } from './usePointerMode'

const DESKTOP_BAR_IDLE_MS = 2800
const TOUCH_BAR_IDLE_MS = 4000

export interface ChromeVisibilityApi {
  showBar: boolean
  showBarRef: MutableRefObject<boolean>
  bumpBar: () => void
  hideBar: () => void
  setShowBar: (v: boolean) => void
  /** Call when play starts so idle hide can re-arm. */
  onPlayingMaybeHide: () => void
  clearHideTimer: () => void
}

/**
 * Control-bar auto show/hide. Idle timeout differs by pointer mode.
 * Menus open / paused keep the bar pinned (caller also ORs CSS class).
 */
export function useChromeVisibility(options: {
  pointerMode: PointerMode
  /** True when speed/SR/danmaku panel menus are open. */
  menusOpen: boolean
  isPaused: () => boolean
}): ChromeVisibilityApi {
  const { pointerMode, menusOpen, isPaused } = options
  const [showBar, setShowBar] = useState(true)
  const showBarRef = useRef(true)
  const hideBarTimer = useRef(0)
  const menusOpenRef = useRef(menusOpen)
  const isPausedRef = useRef(isPaused)
  const modeRef = useRef(pointerMode)

  menusOpenRef.current = menusOpen
  isPausedRef.current = isPaused
  modeRef.current = pointerMode

  const clearHideTimer = useCallback(() => {
    window.clearTimeout(hideBarTimer.current)
  }, [])

  const scheduleBarAutoHide = useCallback(() => {
    window.clearTimeout(hideBarTimer.current)
    const ms =
      modeRef.current === 'desktop' ? DESKTOP_BAR_IDLE_MS : TOUCH_BAR_IDLE_MS
    hideBarTimer.current = window.setTimeout(() => {
      if (isPausedRef.current() || menusOpenRef.current) return
      showBarRef.current = false
      setShowBar(false)
    }, ms)
  }, [])

  const bumpBar = useCallback(() => {
    showBarRef.current = true
    setShowBar(true)
    scheduleBarAutoHide()
  }, [scheduleBarAutoHide])

  const hideBar = useCallback(() => {
    if (menusOpenRef.current) return
    showBarRef.current = false
    setShowBar(false)
    window.clearTimeout(hideBarTimer.current)
  }, [])

  const onPlayingMaybeHide = useCallback(() => {
    scheduleBarAutoHide()
  }, [scheduleBarAutoHide])

  // When menus close while playing, re-arm idle hide
  useEffect(() => {
    if (!menusOpen && !isPaused()) {
      scheduleBarAutoHide()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menusOpen, pointerMode])

  useEffect(() => {
    return () => window.clearTimeout(hideBarTimer.current)
  }, [])

  return {
    showBar,
    showBarRef,
    bumpBar,
    hideBar,
    setShowBar: (v: boolean) => {
      showBarRef.current = v
      setShowBar(v)
    },
    onPlayingMaybeHide,
    clearHideTimer,
  }
}
