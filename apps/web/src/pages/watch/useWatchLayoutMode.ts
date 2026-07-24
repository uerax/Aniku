import { useEffect, useState } from 'react'

/**
 * Page layout mode by viewport width (not pointer).
 * Matches Tailwind `lg` (1024px) used by the cinema grid.
 */
export type WatchLayoutMode = 'desktop' | 'mobile'

const DESKTOP_LAYOUT_QUERY = '(min-width: 1024px)'

export function useWatchLayoutMode(): WatchLayoutMode {
  const [mode, setMode] = useState<WatchLayoutMode>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return 'mobile'
    }
    return window.matchMedia(DESKTOP_LAYOUT_QUERY).matches ? 'desktop' : 'mobile'
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const mql = window.matchMedia(DESKTOP_LAYOUT_QUERY)
    const apply = () => setMode(mql.matches ? 'desktop' : 'mobile')
    apply()
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', apply)
      return () => mql.removeEventListener('change', apply)
    }
    mql.addListener(apply)
    return () => mql.removeListener(apply)
  }, [])

  return mode
}
