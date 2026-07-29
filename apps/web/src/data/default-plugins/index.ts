import type { PluginRule } from '@animaku/shared'
import anime1 from './Anime1.json'
import otage from './otage.json'
import xifan from './xifan.json'
import mxdm from './MXdm.json'
import omofun from './omofun.json'

/**
 * Built-in rules — keep lean.
 * Order: HLS-friendly first; Anime1 last (needs MEDIA_FULL_PROXY=1 for cookie mp4).
 * - otage: MacCMS (otage.cc), plaintext m3u8 via player_aaaa
 * - xifan: 稀饭 anime.xifanacg.com — suggest API search + HTML chapters + player_aaaa
 * - MXdm: MacCMS-style third party
 * - omofun: 211dm/omofuns — server search adapter (verify gate) + XPath chapters + player_aaaa
 * - Anime1: progressive + cookie adapter (client disables when mediaFullProxy=0)
 * More sources: Settings → catalog / import (7sefun, AGE, gugu3 still folder-only).
 */
export const DEFAULT_PLUGIN_RULES: PluginRule[] = [
  mxdm as PluginRule,
  omofun as PluginRule,
  otage as PluginRule,
  xifan as PluginRule,
  anime1 as PluginRule,
]
