import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import {
  defaultDanmakuSettings,
  defaultPlayerSettings,
  type DanmakuSettings,
  type PlayerSettings,
} from '@kazumi-web/shared'

interface SettingsState {
  bangumiToken: string
  theme: 'dark' | 'light'
  danmaku: DanmakuSettings
  player: PlayerSettings
  setBangumiToken: (token: string) => void
  setDanmaku: (partial: Partial<DanmakuSettings>) => void
  resetDanmaku: () => void
  setPlayer: (partial: Partial<PlayerSettings>) => void
  resetPlayer: () => void
}

function mergePlayer(partial?: Partial<PlayerSettings>): PlayerSettings {
  const p = partial && typeof partial === 'object' ? partial : {}
  return {
    ...defaultPlayerSettings,
    ...p,
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
      name: 'kazumi-web-settings',
      storage: createJSONStorage(() => localStorage),
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
    },
  ),
)
