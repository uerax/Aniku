import type { PluginRule } from '@aniku/shared'
import anime1 from './Anime1.json'
import otage from './otage.json'
import xifan from './xifan.json'
import mxdm from './MXdm.json'

/**
 * Built-in rules — keep lean.
 * - Anime1: progressive + cookie adapter
 * - otage: MacCMS (otage.cc), plaintext m3u8 via player_aaaa
 * - xifan: 稀饭 anime.xifanacg.com — suggest API search + HTML chapters + player_aaaa
 * - MXdm: MacCMS-style third party
 * More sources: Settings → catalog / import (7sefun.json still in folder if needed).
 */
export const DEFAULT_PLUGIN_RULES: PluginRule[] = [
  anime1 as PluginRule,
  otage as PluginRule,
  xifan as PluginRule,
  mxdm as PluginRule,
]
