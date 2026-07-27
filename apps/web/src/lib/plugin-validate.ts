import { parsePluginRule, type PluginRule } from '@animaku/shared'

/** Local rule validation — does not call the server (rules stay in the browser). */
export function validatePluginLocal(raw: unknown): {
  ok: boolean
  rule?: PluginRule
  message?: string
} {
  try {
    return { ok: true, rule: parsePluginRule(raw) }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    }
  }
}
