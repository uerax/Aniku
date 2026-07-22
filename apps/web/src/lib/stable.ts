import {
  defaultDanmakuSettings,
  defaultPlayerSettings,
} from '@kazumi-web/shared'

/** Stable empty refs for zustand selectors (avoid infinite re-render) */
export const EMPTY_ARRAY: never[] = []

export const FALLBACK_DANMAKU = { ...defaultDanmakuSettings }

export const FALLBACK_PLAYER = { ...defaultPlayerSettings }
