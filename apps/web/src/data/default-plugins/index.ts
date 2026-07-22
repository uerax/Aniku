import type { PluginRule } from '@aniku/shared'
import sefun from './7sefun.json'
import mxdm from './MXdm.json'

/** Built-in rules — keep lean; more sources via Settings → KazumiRules / import */
export const DEFAULT_PLUGIN_RULES: PluginRule[] = [
  sefun as PluginRule,
  mxdm as PluginRule,
]
