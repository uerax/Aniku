import { useEffect, useState } from 'react'

/**
 * Desktop-like chrome when the primary pointer can hover precisely
 * (mouse/trackpad). Touch-first devices use mobile chrome.
 * Not viewport-based — iPad + trackpad counts as desktop.
 */
export type PointerMode = 'desktop' | 'mobile'

const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)'

export function isFinePointerHover(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia(FINE_POINTER_QUERY).matches
}

export function usePointerMode(): PointerMode {
  const [mode, setMode] = useState<PointerMode>(() =>
    isFinePointerHover() ? 'desktop' : 'mobile',
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const mql = window.matchMedia(FINE_POINTER_QUERY)
    const apply = () => setMode(mql.matches ? 'desktop' : 'mobile')
    apply()
    // Safari < 14 uses addListener; modern browsers use addEventListener
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', apply)
      return () => mql.removeEventListener('change', apply)
    }
    mql.addListener(apply)
    return () => mql.removeListener(apply)
  }, [])

  return mode
}
