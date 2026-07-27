/**
 * Client-side plugin search result cache (session memory + sessionStorage).
 * Chapters use roads-cache.ts; resolve stays on React Query + server TTL.
 */

import type { PluginRule, PluginSearchResult } from '@animaku/shared'

const SEARCH_TTL_MS = 30 * 60_000
const SEARCH_SESSION_TTL_MS = 2 * 60 * 60_000
const MAX_MEMORY = 40

type MemEntry = { value: PluginSearchResult; exp: number }

const memory = new Map<string, MemEntry>()

function ruleStamp(rule: Pick<PluginRule, 'name' | 'version'>): string {
  return `${rule.name}@${rule.version || '0'}`
}

function searchKey(
  rule: Pick<PluginRule, 'name' | 'version'>,
  keyword: string,
): string {
  return `plugin-search:${ruleStamp(rule)}:${keyword.trim().toLowerCase()}`
}

function memoryGet(key: string): PluginSearchResult | undefined {
  const e = memory.get(key)
  if (!e) return undefined
  if (Date.now() > e.exp) {
    memory.delete(key)
    return undefined
  }
  memory.delete(key)
  memory.set(key, e)
  return e.value
}

function memorySet(key: string, value: PluginSearchResult, ttl: number): void {
  if (memory.has(key)) memory.delete(key)
  memory.set(key, { value, exp: Date.now() + ttl })
  while (memory.size > MAX_MEMORY) {
    const oldest = memory.keys().next().value
    if (oldest === undefined) break
    memory.delete(oldest)
  }
}

function sessionGet(key: string): PluginSearchResult | undefined {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as { value: PluginSearchResult; exp: number }
    if (!parsed || Date.now() > parsed.exp) {
      sessionStorage.removeItem(key)
      return undefined
    }
    return parsed.value
  } catch {
    return undefined
  }
}

function sessionSet(
  key: string,
  value: PluginSearchResult,
  ttl: number,
): void {
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({ value, exp: Date.now() + ttl }),
    )
  } catch {
    /* quota */
  }
}

export function getCachedPluginSearch(
  rule: Pick<PluginRule, 'name' | 'version'>,
  keyword: string,
): PluginSearchResult | undefined {
  const key = searchKey(rule, keyword)
  const mem = memoryGet(key)
  if (mem) return mem
  const ses = sessionGet(key)
  if (ses) {
    memorySet(key, ses, SEARCH_TTL_MS)
    return ses
  }
  return undefined
}

export function setCachedPluginSearch(
  rule: Pick<PluginRule, 'name' | 'version'>,
  keyword: string,
  value: PluginSearchResult,
): void {
  const key = searchKey(rule, keyword)
  memorySet(key, value, SEARCH_TTL_MS)
  sessionSet(key, value, SEARCH_SESSION_TTL_MS)
}

export function invalidateCachedPluginSearch(
  rule: Pick<PluginRule, 'name' | 'version'>,
  keyword?: string,
): void {
  if (keyword != null) {
    const key = searchKey(rule, keyword)
    memory.delete(key)
    try {
      sessionStorage.removeItem(key)
    } catch {
      /* ignore */
    }
    return
  }
  const prefix = `plugin-search:${ruleStamp(rule)}:`
  for (const k of [...memory.keys()]) {
    if (k.startsWith(prefix)) memory.delete(k)
  }
}
