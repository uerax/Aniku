import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { PluginMeta, PluginRule } from '@aniku/shared'
import { parsePluginRule } from '@aniku/shared'
import { DEFAULT_PLUGIN_RULES } from '../data/default-plugins'
import { migrateLocalStorageKey } from '../lib/storage'

migrateLocalStorageKey('aniku-plugins', ['kazumi-web-plugins'])

/** Bump when built-in rule set changes so empty/legacy stores re-seed */
/** v8: default adBlocker only on MXdm; Anime1/otage/xifan off */
export const PLUGIN_DEFAULTS_VERSION = 8

interface PluginState {
  plugins: PluginMeta[]
  /** version of built-in defaults last applied (0 = never / legacy empty) */
  defaultsVersion: number
  importRule: (
    raw: unknown,
    opts?: { source?: PluginMeta['source']; enabled?: boolean },
  ) => PluginMeta
  removePlugin: (id: string) => void
  togglePlugin: (id: string, enabled?: boolean) => void
  /** Per-rule HLS ad filter (Kazumi `adBlocker`) */
  setPluginAdBlocker: (id: string, adBlocker: boolean) => void
  getEnabled: () => PluginMeta[]
  getByName: (name: string) => PluginMeta | undefined
  /** If store is empty, write built-in rules (safe to call often) */
  ensureDefaults: () => void
  resetToDefaults: () => void
}

function toMeta(
  rule: PluginRule,
  source: PluginMeta['source'] = 'import',
  enabled = true,
): PluginMeta {
  return {
    ...rule,
    id: `${rule.name}-${rule.version || '0'}`,
    enabled,
    importedAt: Date.now(),
    source,
  }
}

export function seedFromDefaults(): PluginMeta[] {
  const list = DEFAULT_PLUGIN_RULES.map((raw) => {
    try {
      return toMeta(parsePluginRule(raw), 'builtin', true)
    } catch {
      return toMeta(raw as PluginRule, 'builtin', true)
    }
  }).filter(
      (p) =>
        p.name &&
        p.baseURL &&
        (p.searchURL || p.searchMode === 'api' || p.searchApiConfig),
    )
  if (!list.length) {
    console.warn('[plugins] DEFAULT_PLUGIN_RULES produced empty list')
  }
  return preferAnime1First(list)
}

function normalizePlugins(raw: unknown): PluginMeta[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (p): p is PluginMeta =>
      Boolean(p && typeof p === 'object' && typeof (p as PluginMeta).name === 'string'),
  )
}

/** Keep Anime1 at front of the list (search fan-out / settings order). */
function preferAnime1First(list: PluginMeta[]): PluginMeta[] {
  const anime1: PluginMeta[] = []
  const rest: PluginMeta[] = []
  for (const p of list) {
    if ((p.name || '').toLowerCase() === 'anime1') anime1.push(p)
    else rest.push(p)
  }
  if (!anime1.length) return list
  return [...anime1, ...rest]
}

export const usePluginStore = create<PluginState>()(
  persist(
    (set, get) => ({
      plugins: seedFromDefaults(),
      defaultsVersion: PLUGIN_DEFAULTS_VERSION,
      importRule: (raw, opts) => {
        const rule = parsePluginRule(raw)
        const meta = toMeta(
          rule,
          opts?.source ?? 'import',
          opts?.enabled ?? true,
        )
        set((s) => {
          const prev = normalizePlugins(s.plugins)
          const existing = prev.find(
            (p) => p.name.toLowerCase() === meta.name.toLowerCase(),
          )
          if (existing && opts?.enabled === undefined) {
            meta.enabled = existing.enabled
          }
          const rest = prev.filter(
            (p) => p.name.toLowerCase() !== meta.name.toLowerCase(),
          )
          return {
            plugins: [meta, ...rest],
            defaultsVersion: PLUGIN_DEFAULTS_VERSION,
          }
        })
        return meta
      },
      removePlugin: (id) =>
        set((s) => ({
          plugins: normalizePlugins(s.plugins).filter((p) => p.id !== id),
        })),
      togglePlugin: (id, enabled) =>
        set((s) => ({
          plugins: normalizePlugins(s.plugins).map((p) =>
            p.id === id ? { ...p, enabled: enabled ?? !p.enabled } : p,
          ),
        })),
      setPluginAdBlocker: (id, adBlocker) =>
        set((s) => ({
          plugins: normalizePlugins(s.plugins).map((p) =>
            p.id === id ? { ...p, adBlocker } : p,
          ),
        })),
      getEnabled: () =>
        preferAnime1First(
          normalizePlugins(get().plugins).filter((p) => p.enabled !== false),
        ),
      getByName: (name) => {
        const key = name.toLowerCase()
        return normalizePlugins(get().plugins).find(
          (p) => p.name.toLowerCase() === key,
        )
      },
      ensureDefaults: () => {
        const plugins = normalizePlugins(get().plugins)
        const ver = get().defaultsVersion ?? 0
        // Empty → seed; version bump → re-seed only if still purely old built-ins
        // or empty. User-imported/catalog rules are kept.
        if (plugins.length === 0) {
          set({
            plugins: seedFromDefaults(),
            defaultsVersion: PLUGIN_DEFAULTS_VERSION,
          })
          return
        }
        // Already on current defaults version: still merge any *new* built-ins
        // (e.g. xifan) without touching user/catalog rules; keep Anime1 first.
        if (ver >= PLUGIN_DEFAULTS_VERSION) {
          const have = new Set(plugins.map((p) => p.name.toLowerCase()))
          const missing = seedFromDefaults().filter(
            (p) => !have.has(p.name.toLowerCase()),
          )
          let next = plugins
          if (missing.length) next = [...next, ...missing]
          next = preferAnime1First(next)
          if (
            missing.length ||
            (next.length && next[0] !== plugins[0])
          ) {
            set({
              plugins: next,
              defaultsVersion: PLUGIN_DEFAULTS_VERSION,
            })
          }
          return
        }

        // Replace legacy default-only stores with current defaults.
        // v6: drop 7sefun from defaults, add otage (MacCMS / plaintext m3u8).
        // v7: add xifan (稀饭 MacCMS; suggest API search + player_aaaa).
        // v8: adBlocker defaults — only MXdm on among built-ins.
        const legacyBuiltinNames = new Set(
          [
            '7sefun',
            'dm84',
            'enlie',
            'age',
            'gugu3',
            'mxdm',
            'anime1',
            'otage',
            'xifan',
          ].map((s) => s.toLowerCase()),
        )
        const onlyLegacyBuiltins = plugins.every(
          (p) =>
            p.source === 'builtin' ||
            legacyBuiltinNames.has(p.name.toLowerCase()),
        )
        if (onlyLegacyBuiltins) {
          set({
            plugins: seedFromDefaults(),
            defaultsVersion: PLUGIN_DEFAULTS_VERSION,
          })
          return
        }
        // Mixed store: add any new built-ins; drop retired default 7sefun
        // only when it was still marked builtin (user re-import keeps source=import).
        // Also align *builtin* adBlocker flags to current DEFAULT_PLUGIN_RULES
        // without overwriting user/catalog rules.
        const seedByName = new Map(
          seedFromDefaults().map((p) => [p.name.toLowerCase(), p]),
        )
        const have = new Set(plugins.map((p) => p.name.toLowerCase()))
        const missing = seedFromDefaults().filter(
          (p) => !have.has(p.name.toLowerCase()),
        )
        let next = plugins.filter(
          (p) =>
            !(
              p.name.toLowerCase() === '7sefun' &&
              (p.source === 'builtin' || p.source === undefined)
            ),
        )
        next = next.map((p) => {
          if (p.source !== 'builtin' && p.source !== undefined) return p
          const seed = seedByName.get(p.name.toLowerCase())
          if (!seed) return p
          return { ...p, adBlocker: Boolean(seed.adBlocker) }
        })
        if (missing.length) next = [...next, ...missing]
        next = preferAnime1First(next)
        set({
          plugins: next,
          defaultsVersion: PLUGIN_DEFAULTS_VERSION,
        })
      },
      resetToDefaults: () => {
        set({
          plugins: seedFromDefaults(),
          defaultsVersion: PLUGIN_DEFAULTS_VERSION,
        })
      },
    }),
    {
      name: 'aniku-plugins',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        plugins: s.plugins,
        defaultsVersion: s.defaultsVersion,
      }),
      migrate: (persisted, fromVersion) => {
        const p = (persisted || {}) as {
          plugins?: unknown
          defaultsVersion?: number
          _seeded?: boolean
        }
        let plugins = normalizePlugins(p.plugins)
        // v0 / legacy empty list / missing defaults → seed
        if (plugins.length === 0 || fromVersion < 1) {
          if (plugins.length === 0) {
            plugins = seedFromDefaults()
          }
        }
        return {
          plugins,
          defaultsVersion: PLUGIN_DEFAULTS_VERSION,
        }
      },
      merge: (persisted, current) => {
        if (persisted == null) {
          return {
            ...current,
            plugins: seedFromDefaults(),
            defaultsVersion: PLUGIN_DEFAULTS_VERSION,
          }
        }
        const p = persisted as Partial<PluginState> & { _seeded?: boolean }
        let plugins = normalizePlugins(p.plugins)
        // Empty after rehydrate (old empty localStorage) → seed
        if (plugins.length === 0) {
          plugins = seedFromDefaults()
        }
        return {
          ...current,
          plugins,
          defaultsVersion: PLUGIN_DEFAULTS_VERSION,
        }
      },
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error('[plugins] rehydrate failed', error)
        }
        // Always fix empty after rehydrate
        state?.ensureDefaults()
      },
    },
  ),
)

/** Call once at app boot so empty localStorage is fixed before any page reads store */
export function bootstrapPlugins() {
  try {
    usePluginStore.persist.rehydrate?.()
  } catch {
    /* ignore */
  }
  usePluginStore.getState().ensureDefaults()
}
