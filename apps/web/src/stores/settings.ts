import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import {
  defaultDanmakuSettings,
  defaultPlayerSettings,
  PLAYER_SPEEDS,
  type DanmakuSettings,
  type PlayerSettings,
} from '@animaku/shared'
import { createDebouncedStorage } from '../lib/debounced-storage'
import { migrateLocalStorageKey } from '../lib/storage'

/** Debounce settings disk writes (volume scrub / slider spam). */
const SETTINGS_PERSIST_DEBOUNCE_MS = 800

migrateLocalStorageKey('animaku-settings', [
  'aniku-settings',
])

export type AppTheme = 'dark' | 'light'

interface SettingsState {
  bangumiToken: string
  theme: AppTheme
  danmaku: DanmakuSettings
  player: PlayerSettings
  setBangumiToken: (token: string) => void
  setTheme: (theme: AppTheme) => void
  toggleTheme: () => void
  setDanmaku: (partial: Partial<DanmakuSettings>) => void
  resetDanmaku: () => void
  setPlayer: (partial: Partial<PlayerSettings>) => void
  resetPlayer: () => void
}

/** Apply theme to <html> for CSS tokens + native color-scheme. */
export function applyDocumentTheme(theme: AppTheme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  root.style.colorScheme = theme
}

const PLAYER_SPEED_MIN = PLAYER_SPEEDS[0]
const PLAYER_SPEED_MAX = PLAYER_SPEEDS[PLAYER_SPEEDS.length - 1]

function clampPlayerSpeed(speed: unknown): number {
  const n = typeof speed === 'number' && Number.isFinite(speed) ? speed : 1
  return Math.min(PLAYER_SPEED_MAX, Math.max(PLAYER_SPEED_MIN, n))
}

function mergePlayer(partial?: Partial<PlayerSettings>): PlayerSettings {
  const p = partial && typeof partial === 'object' ? partial : {}
  const sr = p.superResolution
  const superResolution =
    sr === 'efficiency' || sr === 'quality' || sr === 'off'
      ? sr
      : defaultPlayerSettings.superResolution
  // Drop legacy playLayout if present in localStorage (unified WatchPage only).
  const { playLayout: _legacyLayout, ...rest } = p as Partial<PlayerSettings> & {
    playLayout?: unknown
  }
  void _legacyLayout
  return {
    ...defaultPlayerSettings,
    ...rest,
    speed: clampPlayerSpeed(rest.speed ?? defaultPlayerSettings.speed),
    superResolution,
    forceAdBlocker: Boolean(
      p.forceAdBlocker ?? defaultPlayerSettings.forceAdBlocker,
    ),
    forceMediaProxy: Boolean(
      p.forceMediaProxy ?? defaultPlayerSettings.forceMediaProxy,
    ),
    skipOp: {
      ...defaultPlayerSettings.skipOp,
      ...(p.skipOp && typeof p.skipOp === 'object' ? p.skipOp : {}),
    },
    skipEd: {
      ...defaultPlayerSettings.skipEd,
      ...(p.skipEd && typeof p.skipEd === 'object' ? p.skipEd : {}),
    },
  }
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      bangumiToken: '',
      theme: 'dark',
      danmaku: { ...defaultDanmakuSettings },
      player: { ...defaultPlayerSettings },
      setBangumiToken: (bangumiToken) => set({ bangumiToken }),
      setTheme: (theme) => {
        applyDocumentTheme(theme)
        set({ theme })
      },
      toggleTheme: () =>
        set((s) => {
          const theme: AppTheme = s.theme === 'light' ? 'dark' : 'light'
          applyDocumentTheme(theme)
          return { theme }
        }),
      setDanmaku: (partial) =>
        set((s) => ({ danmaku: { ...s.danmaku, ...partial } })),
      resetDanmaku: () => set({ danmaku: { ...defaultDanmakuSettings } }),
      setPlayer: (partial) =>
        set((s) => ({
          player: mergePlayer({ ...s.player, ...partial }),
        })),
      resetPlayer: () => set({ player: { ...defaultPlayerSettings } }),
    }),
    {
      name: 'animaku-settings',
      storage: createJSONStorage(() =>
        createDebouncedStorage(SETTINGS_PERSIST_DEBOUNCE_MS),
      ),
      partialize: (s) => ({
        bangumiToken: s.bangumiToken,
        theme: s.theme,
        danmaku: s.danmaku,
        player: s.player,
      }),
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<SettingsState>
        return {
          ...current,
          bangumiToken:
            typeof p.bangumiToken === 'string'
              ? p.bangumiToken
              : current.bangumiToken,
          theme:
            p.theme === 'light' || p.theme === 'dark' ? p.theme : current.theme,
          danmaku: {
            ...defaultDanmakuSettings,
            ...(p.danmaku && typeof p.danmaku === 'object' ? p.danmaku : {}),
          },
          player: mergePlayer(
            p.player && typeof p.player === 'object' ? p.player : undefined,
          ),
        }
      },
      onRehydrateStorage: () => (state) => {
        if (state?.theme) applyDocumentTheme(state.theme)
      },
    },
  ),
)

// Only seed default if index.html early script didn't already set data-theme.
if (
  typeof document !== 'undefined' &&
  !document.documentElement.getAttribute('data-theme')
) {
  applyDocumentTheme('dark')
}
