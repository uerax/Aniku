import type { StateStorage } from 'zustand/middleware'

/**
 * localStorage wrapper that debounces writes.
 * Flushes on `pagehide` / tab hide so progress is not lost on close.
 */
export function createDebouncedStorage(delayMs: number): StateStorage {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: { name: string; value: string } | null = null

  const flush = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    if (!pending) return
    try {
      localStorage.setItem(pending.name, pending.value)
    } catch {
      /* quota / private mode */
    }
    pending = null
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush()
    })
  }

  return {
    getItem: (name) => {
      try {
        // Prefer in-flight write so same-tab readers see latest
        if (pending?.name === name) return pending.value
        return localStorage.getItem(name)
      } catch {
        return null
      }
    },
    setItem: (name, value) => {
      pending = { name, value }
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(flush, delayMs)
    },
    removeItem: (name) => {
      if (pending?.name === name) pending = null
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      try {
        localStorage.removeItem(name)
      } catch {
        /* ignore */
      }
    },
  }
}
