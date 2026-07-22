import type { PluginRule } from '@aniku/shared'
import sefun from './7sefun.json'
import mxdm from './MXdm.json'
import anime1 from './Anime1.json'

/** Built-in rules — keep lean; more sources via Settings → catalog / import */
export const DEFAULT_PLUGIN_RULES: PluginRule[] = [
  anime1 as PluginRule,
  sefun as PluginRule,
  mxdm as PluginRule,
]
