import type { PluginRule } from '@aniku/shared'
import anime1 from './Anime1.json'
import otage from './otage.json'
import mxdm from './MXdm.json'

/**
 * Built-in rules — keep lean.
 * - Anime1: progressive + cookie adapter
 * - otage: MacCMS (otage.cc / AGE 门户), plaintext m3u8 via player_aaaa
 * - MXdm: MacCMS-style third party
 * More sources: Settings → catalog / import (7sefun.json still in folder if needed).
 */
export const DEFAULT_PLUGIN_RULES: PluginRule[] = [
  anime1 as PluginRule,
  otage as PluginRule,
  mxdm as PluginRule,
]
