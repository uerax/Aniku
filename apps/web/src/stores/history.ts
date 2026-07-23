import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { WatchHistoryEntry } from '@aniku/shared'
import { historyId } from '@aniku/shared'
import { createDebouncedStorage } from '../lib/debounced-storage'
import { migrateLocalStorageKey } from '../lib/storage'

migrateLocalStorageKey('aniku-history', ['kazumi-web-history'])

/** Cap persisted history rows */
const MAX_ITEMS = 200
/** Debounce localStorage writes (progress ticks are frequent) */
const PERSIST_DEBOUNCE_MS = 12_000

interface HistoryState {
  items: WatchHistoryEntry[]
  upsert: (
    entry: Omit<WatchHistoryEntry, 'id' | 'updatedAt'> & { id?: string },
  ) => void
  remove: (id: string) => void
  clear: () => void
  get: (id: string) => WatchHistoryEntry | undefined
  forBangumi: (bangumiId: number) => WatchHistoryEntry | undefined
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      items: [],
      upsert: (entry) => {
        const id =
          entry.id ||
          historyId(
            entry.bangumiId,
            entry.pluginName,
            entry.episode,
            entry.road,
          )
        const full: WatchHistoryEntry = {
          ...entry,
          id,
          updatedAt: Date.now(),
        }
        set((s) => {
          const prev = Array.isArray(s.items) ? s.items : []
          // Newest-first without full re-sort: drop old id, unshift, cap
          const rest: WatchHistoryEntry[] = []
          for (const i of prev) {
            if (i.id !== id) rest.push(i)
          }
          return {
            items: [full, ...rest].slice(0, MAX_ITEMS),
          }
        })
      },
      remove: (id) =>
        set((s) => ({
          items: (Array.isArray(s.items) ? s.items : []).filter(
            (i) => i.id !== id,
          ),
        })),
      clear: () => set({ items: [] }),
      get: (id) => {
        const items = get().items
        return (Array.isArray(items) ? items : []).find((i) => i.id === id)
      },
      forBangumi: (bangumiId) => {
        const items = get().items
        return (Array.isArray(items) ? items : []).find(
          (i) => i.bangumiId === bangumiId,
        )
      },
    }),
    {
      name: 'aniku-history',
      storage: createJSONStorage(() => createDebouncedStorage(PERSIST_DEBOUNCE_MS)),
      partialize: (s) => ({ items: s.items }),
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<HistoryState>
        return {
          ...current,
          items: Array.isArray(p.items) ? p.items : current.items,
        }
      },
    },
  ),
)
