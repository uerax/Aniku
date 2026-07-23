/** HTTP template used by API-mode rules (Kazumi ApiRequestConfig) */
export interface ApiRequestConfig {
  method?: string
  url: string
  headers?: Record<string, unknown>
  query?: Record<string, unknown>
  bodyType?: 'none' | 'json' | 'form'
  body?: unknown
}

/** Kazumi ApiSearchConfig — JSON API search */
export interface ApiSearchConfig {
  request: ApiRequestConfig
  listPath: string
  namePath: string
  sourcePath: string
  /**
   * Optional template to turn a bare id/slug from sourcePath into a detail URL.
   * Use `@source` for the raw value (e.g. `/bangumi/@source.html`).
   * When omitted, sourcePath value is used as-is (sorani / TvTFun style).
   */
  sourceTemplate?: string
}

export interface ApiEpisodePageConfig {
  url: string
  query?: Record<string, unknown>
}

/** Kazumi ApiChapterConfig — nested or delimited chapter responses */
export interface ApiChapterConfig {
  request: ApiRequestConfig
  format?: 'nested' | 'delimited'
  roadsPath?: string
  roadNamePath?: string
  episodesPath?: string
  episodeNamePath?: string
  episodeUrlPath?: string
  roadNamesPath?: string
  roadEpisodesPath?: string
  roadSeparator?: string
  episodeSeparator?: string
  fieldSeparator?: string
  variables?: Record<string, string>
  episodePage?: ApiEpisodePageConfig
}

/** Kazumi-compatible plugin rule (subset used by web) */
export interface PluginRule {
  api: string
  type: string
  name: string
  version: string
  muliSources?: boolean
  useWebview?: boolean
  useNativePlayer?: boolean
  usePost?: boolean
  useLegacyParser?: boolean
  adBlocker?: boolean
  userAgent?: string
  baseURL: string
  searchURL: string
  searchList: string
  searchName: string
  searchResult: string
  chapterRoads: string
  chapterResult: string
  referer?: string
  searchMode?: 'xpath' | 'api'
  chapterMode?: 'xpath' | 'api'
  /** Required when searchMode === 'api' (e.g. sorani / TvTFun) */
  searchApiConfig?: ApiSearchConfig
  /** Required when chapterMode === 'api' */
  chapterApiConfig?: ApiChapterConfig
}

export interface PluginMeta extends PluginRule {
  /** client-only */
  enabled: boolean
  id: string
  importedAt: number
  /** how the rule entered the client store */
  source?: 'builtin' | 'import' | 'catalog'
}

/** KazumiRules `index.json` entry (PluginHTTPItem) */
export interface PluginCatalogItem {
  name: string
  version: string
  useNativePlayer: boolean
  author: string
  lastUpdate: number
  antiCrawlerEnabled: boolean
}

export type PluginCatalogStatus = 'install' | 'installed' | 'update'

/** Simple semver-ish compare: true if remote is newer than local (Kazumi needUpdate) */
export function isRemoteNewer(localVersion: string, remoteVersion: string): boolean {
  const local = String(localVersion || '')
    .split('.')
    .map((s) => parseInt(s, 10) || 0)
  const remote = String(remoteVersion || '')
    .split('.')
    .map((s) => parseInt(s, 10) || 0)
  const n = Math.max(local.length, remote.length)
  for (let i = 0; i < n; i++) {
    const l = local[i] ?? 0
    const r = remote[i] ?? 0
    if (r > l) return true
    if (r < l) return false
  }
  return false
}

export function catalogItemStatus(
  installed: { name: string; version: string } | undefined,
  remote: PluginCatalogItem,
): PluginCatalogStatus {
  if (!installed) return 'install'
  if (isRemoteNewer(installed.version, remote.version)) return 'update'
  return 'installed'
}

export interface SearchItem {
  name: string
  src: string
}

export interface Road {
  name: string
  /** absolute episode page URLs */
  data: string[]
  /** episode display names */
  identifier: string[]
}

export interface PluginSearchResult {
  pluginName: string
  items: SearchItem[]
  diagnostics?: string[]
}

export interface PluginChapterResult {
  pluginName: string
  roads: Road[]
  diagnostics?: string[]
}

export interface ResolvePlayResult {
  playUrl: string
  proxyUrl: string
  contentType?: string
  referer?: string
  headers?: Record<string, string>
  diagnostics?: string[]
}

/**
 * Build search keyword candidates (Kazumi-style + short-head variants).
 * Order: short heads / cleaned titles first, then aliases, then full titles.
 * Caller may try several until a plugin returns hits; UI also exposes 别名/手动.
 */
export function buildSearchKeywords(
  nameCn?: string | null,
  name?: string | null,
  aliases?: string[] | null,
): string[] {
  const titles = [nameCn, name, ...(aliases || [])]
    .map((s) => (s || '').trim())
    .filter(Boolean)

  const variants: string[] = []
  const push = (s: string) => {
    const t = s.replace(/\s+/g, ' ').trim()
    if (!t || t.length < 2) return
    // skip overly long noise (full season subtitles rarely hit site search)
    if (t.length > 48) return
    if (!variants.some((v) => v.toLowerCase() === t.toLowerCase())) {
      variants.push(t)
    }
  }

  for (const title of titles) {
    // head first (best hit rate on MacCMS / anime sites)
    const head = title.split(/[\s　:：\-–—·・]/)[0]
    if (head) push(head)
    push(title.replace(/[～~].*?[～~]/g, ' ').replace(/\s+/g, ' '))
    push(title.replace(/[（(][^）)]*[）)]/g, ' ').replace(/\s+/g, ' '))
    // drop season markers like 第2期 / S2 / Season 2
    push(
      title
        .replace(/(第?\s*\d+\s*[期季部作]|S\s*\d+|Season\s*\d+)/gi, ' ')
        .replace(/\s+/g, ' '),
    )
    push(title)
  }

  // Prefer shorter keywords (higher site hit rate), then stable order
  return variants.sort((a, b) => a.length - b.length || a.localeCompare(b))
}

/**
 * Cheap title similarity for ranking plugin hits (not a full fuzzy matcher).
 * Used like Kazumi's human pick: surface closer names first, still list all.
 */
export function titleSimilarity(a: string, b: string): number {
  const s1 = (a || '').toLowerCase().replace(/\s+/g, '')
  const s2 = (b || '').toLowerCase().replace(/\s+/g, '')
  if (!s1 || !s2) return 0
  if (s1 === s2) return 1
  if (s1.includes(s2) || s2.includes(s1)) {
    return 0.85 + 0.1 * (Math.min(s1.length, s2.length) / Math.max(s1.length, s2.length))
  }
  // character Jaccard-ish
  const set1 = new Set(s1)
  let inter = 0
  for (const ch of s2) if (set1.has(ch)) inter++
  const union = new Set([...s1, ...s2]).size || 1
  const jaccard = inter / union
  // bigram overlap for CJK titles
  const bigrams = (s: string) => {
    const out: string[] = []
    for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2))
    return out
  }
  const b1 = bigrams(s1)
  const b2 = new Set(bigrams(s2))
  let bi = 0
  for (const g of b1) if (b2.has(g)) bi++
  const biScore = b1.length ? bi / b1.length : 0
  return Math.max(jaccard * 0.6 + biScore * 0.4, jaccard)
}

/** Best score of `name` against any reference title (cn/en/aliases). */
export function bestTitleSimilarity(
  name: string,
  references: Array<string | null | undefined>,
): number {
  let best = 0
  for (const ref of references) {
    if (!ref) continue
    best = Math.max(best, titleSimilarity(name, ref))
  }
  return best
}

/** Sort search hits closer to Bangumi titles first (all items kept). */
export function rankSearchItems<T extends { name: string }>(
  items: T[],
  references: Array<string | null | undefined>,
): T[] {
  if (!items.length) return items
  return [...items].sort((a, b) => {
    const sb = bestTitleSimilarity(b.name, references)
    const sa = bestTitleSimilarity(a.name, references)
    if (sb !== sa) return sb - sa
    return a.name.length - b.name.length
  })
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseApiRequestConfig(raw: unknown): ApiRequestConfig {
  const j = asObject(raw) || {}
  const url = String(j.url ?? '').trim()
  if (!url) throw new Error('API 请求缺少 url')
  const method = String(j.method ?? 'GET').toUpperCase()
  const bodyTypeRaw = String(j.bodyType ?? 'none')
  const bodyType =
    bodyTypeRaw === 'json' || bodyTypeRaw === 'form' ? bodyTypeRaw : 'none'
  return {
    method,
    url,
    headers: asObject(j.headers) || undefined,
    query: asObject(j.query) || undefined,
    bodyType,
    body: j.body,
  }
}

function parseApiSearchConfig(raw: unknown): ApiSearchConfig {
  const j = asObject(raw)
  if (!j) throw new Error('searchApiConfig 无效')
  const listPath = String(j.listPath ?? '').trim()
  const namePath = String(j.namePath ?? '').trim()
  const sourcePath = String(j.sourcePath ?? '').trim()
  if (!listPath || !namePath || !sourcePath) {
    throw new Error('searchApiConfig 缺少 listPath / namePath / sourcePath')
  }
  const sourceTemplate = String(j.sourceTemplate ?? '').trim()
  return {
    request: parseApiRequestConfig(j.request),
    listPath,
    namePath,
    sourcePath,
    ...(sourceTemplate ? { sourceTemplate } : {}),
  }
}

function parseApiChapterConfig(raw: unknown): ApiChapterConfig {
  const j = asObject(raw)
  if (!j) throw new Error('chapterApiConfig 无效')
  const format = j.format === 'delimited' ? 'delimited' : 'nested'
  const episodePageRaw = asObject(j.episodePage)
  const episodePage = episodePageRaw
    ? {
        url: String(episodePageRaw.url ?? '').trim(),
        query: asObject(episodePageRaw.query) || undefined,
      }
    : undefined
  if (episodePage && !episodePage.url) {
    throw new Error('chapterApiConfig.episodePage.url 不能为空')
  }
  const variablesRaw = asObject(j.variables)
  const variables: Record<string, string> | undefined = variablesRaw
    ? Object.fromEntries(
        Object.entries(variablesRaw).map(([k, v]) => [k, String(v ?? '')]),
      )
    : undefined
  return {
    request: parseApiRequestConfig(j.request),
    format,
    roadsPath: String(j.roadsPath ?? ''),
    roadNamePath: String(j.roadNamePath ?? ''),
    episodesPath: String(j.episodesPath ?? ''),
    episodeNamePath: String(j.episodeNamePath ?? ''),
    episodeUrlPath: String(j.episodeUrlPath ?? ''),
    roadNamesPath: String(j.roadNamesPath ?? ''),
    roadEpisodesPath: String(j.roadEpisodesPath ?? ''),
    roadSeparator: String(j.roadSeparator ?? '$$$'),
    episodeSeparator: String(j.episodeSeparator ?? '#'),
    fieldSeparator: String(j.fieldSeparator ?? '$'),
    variables,
    episodePage,
  }
}

export function parsePluginRule(raw: unknown): PluginRule {
  if (!raw || typeof raw !== 'object') {
    throw new Error('插件 JSON 无效')
  }
  const j = raw as Record<string, unknown>
  const name = String(j.name ?? '').trim()
  const baseURL = String(j.baseURL ?? j.baseUrl ?? '').trim()
  const searchURL = String(j.searchURL ?? '').trim()
  const searchMode = j.searchMode === 'api' ? 'api' : 'xpath'
  const chapterMode = j.chapterMode === 'api' ? 'api' : 'xpath'

  if (!name || !baseURL) {
    throw new Error('插件缺少 name / baseURL')
  }

  let searchApiConfig: ApiSearchConfig | undefined
  let chapterApiConfig: ApiChapterConfig | undefined

  if (searchMode === 'api') {
    // API rules (sorani / TvTFun) leave searchURL empty and use searchApiConfig
    if (!j.searchApiConfig) {
      throw new Error('API 搜索规则缺少 searchApiConfig')
    }
    searchApiConfig = parseApiSearchConfig(j.searchApiConfig)
  } else if (!searchURL) {
    throw new Error('插件缺少 name / baseURL / searchURL')
  }

  if (chapterMode === 'api') {
    if (!j.chapterApiConfig) {
      throw new Error('API 章节规则缺少 chapterApiConfig')
    }
    chapterApiConfig = parseApiChapterConfig(j.chapterApiConfig)
  }

  return {
    api: String(j.api ?? '1'),
    type: String(j.type ?? 'anime'),
    name,
    version: String(j.version ?? ''),
    muliSources: Boolean(j.muliSources ?? true),
    useWebview: Boolean(j.useWebview ?? true),
    useNativePlayer: Boolean(j.useNativePlayer ?? true),
    usePost: Boolean(j.usePost ?? false),
    useLegacyParser: Boolean(j.useLegacyParser ?? false),
    adBlocker: Boolean(j.adBlocker ?? false),
    userAgent: String(j.userAgent ?? ''),
    baseURL,
    searchURL,
    searchList: String(j.searchList ?? ''),
    searchName: String(j.searchName ?? ''),
    searchResult: String(j.searchResult ?? ''),
    chapterRoads: String(j.chapterRoads ?? ''),
    chapterResult: String(j.chapterResult ?? ''),
    referer: String(j.referer ?? ''),
    searchMode,
    chapterMode,
    searchApiConfig,
    chapterApiConfig,
  }
}
