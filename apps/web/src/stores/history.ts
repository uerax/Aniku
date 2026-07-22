import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { WatchHistoryEntry } from '@kazumi-web/shared'
import { historyId } from '@kazumi-web/shared'

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
          const rest = prev.filter((i) => i.id !== id)
          return {
            items: [full, ...rest]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .slice(0, 200),
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
      name: 'kazumi-web-history',
      storage: createJSONStorage(() => localStorage),
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
