/**
 * API-mode plugin engine (Kazumi ApiRuleStrategy subset).
 * Supports searchApiConfig / chapterApiConfig used by rules like sorani, TvTFun.
 */
import type {
  ApiChapterConfig,
  ApiRequestConfig,
  ApiSearchConfig,
  PluginRule,
  Road,
  SearchItem,
} from '@kazumi-web/shared'
import { config } from '../config'

/** Local copy to avoid circular import with rule-engine/index.ts */
function normalizeEpisodeUrl(baseUrl: string, raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  let resolved: URL | null = null
  try {
    resolved = new URL(trimmed)
  } catch {
    try {
      resolved = new URL(trimmed, baseUrl)
    } catch {
      return trimmed
    }
  }
  try {
    const base = new URL(baseUrl)
    if (
      resolved.host === base.host &&
      (resolved.protocol === 'http:' || resolved.protocol === 'https:') &&
      (base.protocol === 'http:' || base.protocol === 'https:') &&
      resolved.protocol !== base.protocol
    ) {
      resolved.protocol = base.protocol
    }
  } catch {
    /* ignore */
  }
  let path = resolved.pathname
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  resolved.pathname = path
  return resolved.toString()
}

export class ApiRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApiRuleError'
  }
}

/** Restricted JSONPath: $, .field, ["field"], [n], [*] only (no filters / ..). */
export function validateJsonPath(expression: string): void {
  if (!expression || !expression.startsWith('$')) {
    throw new ApiRuleError(`JSONPath 必须以 $ 开头: ${expression}`)
  }
  let index = 1
  while (index < expression.length) {
    const char = expression[index]
    if (char === '.') {
      index++
      const start = index
      while (
        index < expression.length &&
        /[A-Za-z0-9_$-]/.test(expression[index])
      ) {
        index++
      }
      if (index === start) {
        throw new ApiRuleError(`不支持的 JSONPath: ${expression}`)
      }
      continue
    }
    if (char === '[') {
      const end = findBracketEnd(expression, index)
      const content = expression.slice(index + 1, end).trim()
      const isIndex = /^\d+$/.test(content)
      const isWildcard = content === '*'
      const isQuoted =
        content.length >= 2 &&
        ((content.startsWith("'") && content.endsWith("'")) ||
          (content.startsWith('"') && content.endsWith('"')))
      if (!isIndex && !isWildcard && !isQuoted) {
        throw new ApiRuleError(`不支持的 JSONPath 片段: [${content}]`)
      }
      index = end + 1
      continue
    }
    throw new ApiRuleError(`不支持的 JSONPath: ${expression}`)
  }
}

function findBracketEnd(expression: string, start: number): number {
  let quote: string | null = null
  let escaped = false
  for (let i = start + 1; i < expression.length; i++) {
    const char = expression[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === ']') return i
  }
  throw new ApiRuleError(`JSONPath 缺少 ]: ${expression}`)
}

/**
 * Evaluate restricted JSONPath against a JSON document.
 * Returns all matched values (wildcard expands).
 */
export function jsonPathRead(document: unknown, expression: string): unknown[] {
  validateJsonPath(expression)
  if (expression === '$') return [document]

  type Token =
    | { kind: 'field'; name: string }
    | { kind: 'index'; n: number }
    | { kind: 'wildcard' }

  const tokens: Token[] = []
  let i = 1
  while (i < expression.length) {
    if (expression[i] === '.') {
      i++
      const start = i
      while (i < expression.length && /[A-Za-z0-9_$-]/.test(expression[i])) i++
      tokens.push({ kind: 'field', name: expression.slice(start, i) })
      continue
    }
    if (expression[i] === '[') {
      const end = findBracketEnd(expression, i)
      const content = expression.slice(i + 1, end).trim()
      if (content === '*') tokens.push({ kind: 'wildcard' })
      else if (/^\d+$/.test(content))
        tokens.push({ kind: 'index', n: Number(content) })
      else {
        const name = content.slice(1, -1)
        tokens.push({ kind: 'field', name })
      }
      i = end + 1
      continue
    }
    break
  }

  let nodes: unknown[] = [document]
  for (const tok of tokens) {
    const next: unknown[] = []
    for (const node of nodes) {
      if (node == null) continue
      if (tok.kind === 'field') {
        if (typeof node === 'object' && !Array.isArray(node)) {
          next.push((node as Record<string, unknown>)[tok.name])
        }
      } else if (tok.kind === 'index') {
        if (Array.isArray(node) && tok.n >= 0 && tok.n < node.length) {
          next.push(node[tok.n])
        }
      } else if (tok.kind === 'wildcard') {
        if (Array.isArray(node)) next.push(...node)
        else if (typeof node === 'object' && node) {
          next.push(...Object.values(node as Record<string, unknown>))
        }
      }
    }
    nodes = next.filter((v) => v !== undefined)
  }
  return nodes
}

export function jsonPathReadFirst(
  document: unknown,
  expression: string,
): unknown {
  const values = jsonPathRead(document, expression)
  return values.length ? values[0] : null
}

function stringValue(value: unknown): string {
  if (value == null) return ''
  return typeof value === 'string' ? value.trim() : String(value)
}

function renderTemplate(
  template: string,
  variables: Record<string, unknown>,
  encode = false,
): string {
  return template.replace(
    /(?<![A-Za-z0-9_])@([A-Za-z_][A-Za-z0-9_]*)/g,
    (_, name: string) => {
      if (!(name in variables)) {
        throw new ApiRuleError(`缺少模板变量 @${name}`)
      }
      const value = variables[name] == null ? '' : String(variables[name])
      return encode ? encodeURIComponent(value) : value
    },
  )
}

function renderValue(
  value: unknown,
  variables: Record<string, unknown>,
): unknown {
  if (typeof value === 'string') {
    const exact = /^@([A-Za-z_][A-Za-z0-9_]*)$/.exec(value)
    if (exact) {
      const name = exact[1]
      if (!(name in variables)) {
        throw new ApiRuleError(`缺少模板变量 @${name}`)
      }
      return variables[name]
    }
    return renderTemplate(value, variables)
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderValue(item, variables))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[String(renderTemplate(k, variables))] = renderValue(v, variables)
    }
    return out
  }
  return value
}

function renderMap(
  input: Record<string, unknown> | undefined,
  variables: Record<string, unknown>,
): Record<string, unknown> {
  if (!input) return {}
  return renderValue(input, variables) as Record<string, unknown>
}

export async function executeApiRequest(
  req: ApiRequestConfig,
  variables: Record<string, unknown>,
  rule: PluginRule,
): Promise<unknown> {
  const method = (req.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'POST') {
    throw new ApiRuleError(`仅支持 GET/POST，当前为 ${method}`)
  }
  if (!req.url?.trim()) throw new ApiRuleError('API 请求 URL 不能为空')

  const urlStr = renderTemplate(req.url.trim(), variables, true)
  let uri: URL
  try {
    uri = new URL(urlStr)
  } catch {
    throw new ApiRuleError(`API 请求 URL 无效: ${urlStr}`)
  }

  const query = renderMap(req.query, variables)
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue
    uri.searchParams.set(k, String(v))
  }

  const headers: Record<string, string> = {
    'User-Agent': rule.userAgent || config.defaultUserAgent,
    Accept: 'application/json,text/plain,*/*',
  }
  if (rule.referer) headers.Referer = rule.referer
  else if (rule.baseURL) headers.Referer = rule.baseURL

  const extraHeaders = renderMap(req.headers, variables)
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (v != null) headers[k] = String(v)
  }

  let body: string | undefined
  if (method === 'POST' && req.bodyType && req.bodyType !== 'none') {
    const rendered = renderValue(req.body, variables)
    if (req.bodyType === 'json') {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(rendered ?? {})
    } else if (req.bodyType === 'form') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      const params = new URLSearchParams()
      if (rendered && typeof rendered === 'object' && !Array.isArray(rendered)) {
        for (const [k, v] of Object.entries(
          rendered as Record<string, unknown>,
        )) {
          if (v != null) params.set(k, String(v))
        }
      }
      body = params.toString()
    }
  }

  const res = await fetch(uri.toString(), {
    method,
    headers,
    body,
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    throw new ApiRuleError(`API 返回 ${res.status}: ${uri.toString()}`)
  }
  const text = await res.text()
  try {
    return JSON.parse(text) as unknown
  } catch (e) {
    throw new ApiRuleError(
      `API 响应不是有效 JSON: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

export function parseApiSearch(
  document: unknown,
  cfg: ApiSearchConfig,
): { items: SearchItem[]; diagnostics: string[] } {
  validateJsonPath(cfg.listPath)
  validateJsonPath(cfg.namePath)
  validateJsonPath(cfg.sourcePath)
  const nodes = jsonPathRead(document, cfg.listPath)
  const items: SearchItem[] = []
  const diagnostics: string[] = []
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]
    try {
      const name = stringValue(jsonPathReadFirst(node, cfg.namePath))
      const source = stringValue(jsonPathReadFirst(node, cfg.sourcePath))
      if (!name || !source) {
        diagnostics.push(`搜索节点 ${index} 缺少名称或来源，已跳过`)
        continue
      }
      items.push({ name, src: source })
    } catch (e) {
      diagnostics.push(
        `搜索节点 ${index} 解析失败: ${e instanceof Error ? e.message : e}`,
      )
    }
  }
  return { items, diagnostics }
}

function resolveEpisodeUrl(
  cfg: ApiChapterConfig,
  rootVariables: Record<string, unknown>,
  opts: {
    rawUrl: string
    roadIndex: number
    episodeIndex: number
    baseUrl: string
  },
): string {
  const page = cfg.episodePage
  if (!page) return normalizeEpisodeUrl(opts.baseUrl, opts.rawUrl)
  if (!page.url?.trim()) throw new ApiRuleError('播放页地址模板不能为空')

  const variables: Record<string, unknown> = {
    ...rootVariables,
    episodeUrl: opts.rawUrl,
    roadIndex: opts.roadIndex,
    roadNumber: opts.roadIndex + 1,
    episodeIndex: opts.episodeIndex,
    episodeNumber: opts.episodeIndex + 1,
  }
  const path = renderTemplate(page.url, variables, true)
  let uri: URL
  try {
    uri = new URL(path)
  } catch {
    // relative template
    try {
      uri = new URL(path, opts.baseUrl)
    } catch {
      throw new ApiRuleError(`剧集页面 URL 无效: ${path}`)
    }
  }
  const renderedQuery = renderMap(page.query, variables)
  for (const [k, v] of Object.entries(renderedQuery)) {
    if (v != null) uri.searchParams.set(k, String(v))
  }
  return normalizeEpisodeUrl(opts.baseUrl, uri.toString())
}

export function parseApiChapters(
  document: unknown,
  cfg: ApiChapterConfig,
  source: string,
  baseUrl: string,
): { roads: Road[]; diagnostics: string[] } {
  const diagnostics: string[] = []
  const rootVariables: Record<string, unknown> = { source }
  if (cfg.variables) {
    for (const [key, path] of Object.entries(cfg.variables)) {
      validateJsonPath(path)
      const value = jsonPathReadFirst(document, path)
      if (value == null) {
        throw new ApiRuleError(`章节响应变量 ${key} 未匹配到值: ${path}`)
      }
      rootVariables[key] = value
    }
  }

  if (cfg.format === 'delimited') {
    return parseDelimited(document, cfg, rootVariables, baseUrl, diagnostics)
  }
  return parseNested(document, cfg, rootVariables, baseUrl, diagnostics)
}

function parseNested(
  document: unknown,
  cfg: ApiChapterConfig,
  rootVariables: Record<string, unknown>,
  baseUrl: string,
  diagnostics: string[],
): { roads: Road[]; diagnostics: string[] } {
  const roadsPath = (cfg.roadsPath || '').trim()
  const hasRoads = Boolean(roadsPath)
  if (hasRoads) validateJsonPath(roadsPath)
  const roadNodes = hasRoads
    ? jsonPathRead(document, roadsPath)
    : [document]

  const episodesPath = (cfg.episodesPath || '').trim()
  if (!episodesPath) throw new ApiRuleError('chapterApiConfig 缺少 episodesPath')
  validateJsonPath(episodesPath)
  const episodeNamePath = (cfg.episodeNamePath || '$.name').trim()
  validateJsonPath(episodeNamePath)
  const episodeUrlPath = (cfg.episodeUrlPath || '').trim()
  if (episodeUrlPath) validateJsonPath(episodeUrlPath)
  else if (!cfg.episodePage) {
    throw new ApiRuleError('必须配置 episodeUrlPath 或 episodePage')
  }
  const roadNamePath = (cfg.roadNamePath || '').trim()
  if (roadNamePath) validateJsonPath(roadNamePath)

  const roads: Road[] = []
  for (let roadIndex = 0; roadIndex < roadNodes.length; roadIndex++) {
    const roadNode = roadNodes[roadIndex]
    try {
      const roadName =
        hasRoads && roadNamePath
          ? stringValue(jsonPathReadFirst(roadNode, roadNamePath))
          : ''
      const episodeNodes = jsonPathRead(roadNode, episodesPath)
      const urls: string[] = []
      const names: string[] = []
      for (let episodeIndex = 0; episodeIndex < episodeNodes.length; episodeIndex++) {
        try {
          const episodeNode = episodeNodes[episodeIndex]
          const episodeName = stringValue(
            jsonPathReadFirst(episodeNode, episodeNamePath),
          )
          const rawUrl = episodeUrlPath
            ? stringValue(jsonPathReadFirst(episodeNode, episodeUrlPath))
            : ''
          const pageUrl = resolveEpisodeUrl(cfg, rootVariables, {
            rawUrl,
            roadIndex,
            episodeIndex,
            baseUrl,
          })
          if (!pageUrl) {
            diagnostics.push(
              `线路 ${roadIndex} 的剧集节点 ${episodeIndex} 缺少 URL，已跳过`,
            )
            continue
          }
          urls.push(pageUrl)
          names.push(episodeName || `第${episodeIndex + 1}集`)
        } catch (e) {
          if (e instanceof ApiRuleError) throw e
          diagnostics.push(
            `线路 ${roadIndex} 的剧集节点 ${episodeIndex} 解析失败: ${e instanceof Error ? e.message : e}`,
          )
        }
      }
      if (!urls.length) {
        diagnostics.push(`线路节点 ${roadIndex} 没有有效剧集，已跳过`)
        continue
      }
      roads.push({
        name: roadName || `播放线路${roads.length + 1}`,
        data: urls,
        identifier: names,
      })
    } catch (e) {
      if (e instanceof ApiRuleError) throw e
      diagnostics.push(
        `线路节点 ${roadIndex} 解析失败: ${e instanceof Error ? e.message : e}`,
      )
    }
  }
  return { roads, diagnostics }
}

function parseDelimited(
  document: unknown,
  cfg: ApiChapterConfig,
  rootVariables: Record<string, unknown>,
  baseUrl: string,
  diagnostics: string[],
): { roads: Road[]; diagnostics: string[] } {
  const roadNamesPath = (cfg.roadNamesPath || '').trim()
  const roadEpisodesPath = (cfg.roadEpisodesPath || '').trim()
  if (!roadEpisodesPath) {
    throw new ApiRuleError('delimited 模式缺少 roadEpisodesPath')
  }
  if (roadNamesPath) validateJsonPath(roadNamesPath)
  validateJsonPath(roadEpisodesPath)
  const roadSeparator = cfg.roadSeparator || '$$$'
  const episodeSeparator = cfg.episodeSeparator || '#'
  const fieldSeparator = cfg.fieldSeparator || '$'

  const namesValue = roadNamesPath
    ? stringValue(jsonPathReadFirst(document, roadNamesPath))
    : ''
  const episodesValue = stringValue(
    jsonPathReadFirst(document, roadEpisodesPath),
  )
  if (!episodesValue) return { roads: [], diagnostics }

  const roadNames = namesValue ? namesValue.split(roadSeparator) : []
  const roadGroups = episodesValue.split(roadSeparator)
  const roads: Road[] = []

  for (let roadIndex = 0; roadIndex < roadGroups.length; roadIndex++) {
    const urls: string[] = []
    const names: string[] = []
    const entries = roadGroups[roadIndex].split(episodeSeparator)
    for (let episodeIndex = 0; episodeIndex < entries.length; episodeIndex++) {
      const entry = entries[episodeIndex].trim()
      if (!entry) continue
      const sepIdx = entry.indexOf(fieldSeparator)
      if (sepIdx < 0) {
        diagnostics.push(
          `线路 ${roadIndex} 的剧集条目 ${episodeIndex} 缺少字段分隔符，已跳过`,
        )
        continue
      }
      const name = entry.slice(0, sepIdx).trim()
      const rawUrl = entry.slice(sepIdx + fieldSeparator.length).trim()
      try {
        const pageUrl = resolveEpisodeUrl(cfg, rootVariables, {
          rawUrl,
          roadIndex,
          episodeIndex,
          baseUrl,
        })
        if (!pageUrl) {
          diagnostics.push(
            `线路 ${roadIndex} 的剧集条目 ${episodeIndex} 缺少 URL，已跳过`,
          )
          continue
        }
        urls.push(pageUrl)
        names.push(name || `第${episodeIndex + 1}集`)
      } catch (e) {
        if (e instanceof ApiRuleError) throw e
        diagnostics.push(
          `线路 ${roadIndex} 的剧集条目 ${episodeIndex} 解析失败: ${e instanceof Error ? e.message : e}`,
        )
      }
    }
    if (!urls.length) {
      diagnostics.push(`线路 ${roadIndex} 没有有效剧集，已跳过`)
      continue
    }
    const configuredName =
      roadIndex < roadNames.length ? roadNames[roadIndex].trim() : ''
    roads.push({
      name: configuredName || `播放线路${roads.length + 1}`,
      data: urls,
      identifier: names,
    })
  }
  return { roads, diagnostics }
}

export async function searchWithApiRule(
  rule: PluginRule,
  keyword: string,
): Promise<{ items: SearchItem[]; diagnostics: string[] }> {
  const cfg = rule.searchApiConfig
  if (!cfg) throw new ApiRuleError('缺少 searchApiConfig')
  const document = await executeApiRequest(cfg.request, { keyword }, rule)
  return parseApiSearch(document, cfg)
}

export async function chaptersWithApiRule(
  rule: PluginRule,
  source: string,
): Promise<{ roads: Road[]; diagnostics: string[] }> {
  const cfg = rule.chapterApiConfig
  if (!cfg) throw new ApiRuleError('缺少 chapterApiConfig')
  const document = await executeApiRequest(cfg.request, { source }, rule)
  return parseApiChapters(document, cfg, source, rule.baseURL)
}
