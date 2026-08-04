/**
 * Release-page domain resolver.
 *
 * Some video site networks use a permanent "release page" (often on GitHub Pages)
 * that lists currently-active mirror domains via XOR-obfuscated inline JS arrays.
 * This module fetches the release page, XOR-decode the domain list, and returns
 * the latest base URL so the rule engine can use it transparently.
 *
 * Why dedicated:
 * - Domains churn regularly (DNS blocking); the release page is the sole
 *   long-lived registry of active domains.
 * - XOR encoding prevents static scrapers from extracting plain-text URLs.
 * - The result is a plain baseURL that feeds into the generic XPath/API engine,
 *   so search / chapters / resolve stay unchanged.
 */

import { PluginRule, ReleaseConfig } from '@animaku/shared'
import { assertPublicHttpUrl, fetchPublic } from './private-host'

// --------------- cache ---------------

interface CacheEntry {
  url: string
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()
const MAX_CACHE_SIZE = 32

function cacheGet(key: string): string | null {
  const entry = cache.get(key)
  if (!entry) return null
  const ageHrs = (Date.now() - entry.fetchedAt) / 3_600_000
  const fetchHour = parseInt(key.split('|')[1], 10) || 2
  if (ageHrs > fetchHour) {
    cache.delete(key)
    return null
  }
  return entry.url
}

function cacheSet(key: string, url: string) {
  if (cache.size >= MAX_CACHE_SIZE) {
    const first = cache.keys().next().value
    if (first) cache.delete(first)
  }
  cache.set(key, { url, fetchedAt: Date.now() })
}

// --------------- XOR decode ---------------

function xorDecode(encoded: string, key: string): string {
  const bytes = encoded.split(',').map((s) => parseInt(s.trim(), 10))
  let result = ''
  for (let i = 0; i < bytes.length; i++) {
    result += String.fromCharCode(bytes[i] ^ key.charCodeAt(i % key.length))
  }
  return result
}

// --------------- extract from HTML ---------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Search inline script blocks for a JS array of objects with XOR-encoded `e`
 * fields, decode each, and return the plain-text domain list.
 */
function extractDomains(html: string, config: ReleaseConfig): string[] {
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi
  const varName = config.varName || 'sites'
  const configKey = config.xorKey || ''

  let match: RegExpExecArray | null
  while ((match = scriptRe.exec(html)) !== null) {
    const body = match[1]

    // Find the array assignment: var/const/let <varName> = [ ... ];
    const varPat = new RegExp(
      `(?:var|const|let)\\s+${escapeRe(varName)}\\s*=\\s*\\[([\\s\\S]*?)\\];`,
      'i',
    )
    const arrMatch = varPat.exec(body)
    if (!arrMatch) continue

    // Extract XOR key from same script block: const _K = 'lv2025';
    const kMatch = /const\s+(_[A-Z_a-z$][\w$]*)\s*=\s*['"]([^'"]+)['"]/i.exec(body)
    const effectiveKey = kMatch ? kMatch[2] : configKey
    if (!effectiveKey) continue

    // Extract each `e: xorDec(‘...’, ...)`
    const decodeRe = /e:\s*xorDecode\s*\(\s*['"]([^'"]+)['"]\s*,/g
    const domains: string[] = []
    let dMatch: RegExpExecArray | null
    while ((dMatch = decodeRe.exec(arrMatch[1])) !== null) {
      domains.push(xorDecode(dMatch[1], effectiveKey))
    }
    if (domains.length > 0) return domains
  }
  return []
}

// --------------- public API --------------- ---------------

/** Force-clear cached entry so the next call re-fetches. */
export function invalidateReleaseCache(config: ReleaseConfig): void {
  const cacheKey = `${config.pageUrl}:${config.fetchHour || 2}:${config.domainIndex || 0}`
  cache.delete(cacheKey)
}

/**
 * Resolve the current active base URL from a release page.
 * Returns `null` when the release page is unreachable or no domain can be decoded.
 */
export async function resolveReleaseBaseUrl(rule: PluginRule, forceRefresh = false): Promise<string | null> {
  const config = rule.release
  if (!config) return null

  const cacheKey = `${config.pageUrl}:${config.fetchHour || 2}:${config.domainIndex || 0}`
  if (forceRefresh) cache.delete(cacheKey)
  else {
    const cached = cacheGet(cacheKey)
    if (cached) return cached
  }

  const ua =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

  let html: string
  try {
    const res = await fetchPublic(config.pageUrl, { headers: { 'User-Agent': ua } })
    if (!res.ok) throw new Error(`release page returned ${res.status}`)
    html = await res.text()
  } catch {
    try {
      const res2 = await fetchPublic(config.pageUrl, {
        headers: {
          'User-Agent':
            'Aimiber/0.1.0 (Linux; x86_64)',
        },
      })
      if (!res2.ok) return null
      html = await res2.text()
    } catch {
      return null
    }
  }

  const domains = extractDomains(html, config)
  if (!domains.length) return null

  const idx = Math.min(config.domainIndex ?? 0, domains.length - 1)
  const raw = domains[idx]?.trim()
  if (!raw) return null

  try {
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    const baseURL = assertPublicHttpUrl(candidate, 'release domain').toString()
    cacheSet(cacheKey, baseURL)
    return baseURL
  } catch {
    return null
  }
}

/** Check if a rule is a release-page type. */
export function isReleaseRule(rule: PluginRule): boolean {
  return !!(rule.release?.pageUrl)
}