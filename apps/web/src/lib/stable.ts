import {
  defaultDanmakuSettings,
  defaultPlayerSettings,
} from '@animaku/shared'

/** Stable empty refs for zustand selectors (avoid infinite re-render) */
export const EMPTY_ARRAY: never[] = []

export const FALLBACK_DANMAKU = { ...defaultDanmakuSettings }

export const FALLBACK_PLAYER = { ...defaultPlayerSettings }
