/**
 * Simplified → Traditional (Taiwan) via OpenCC.
 * Used for anime1.me (zh-TW) search keywords.
 */
import OpenCC from 'opencc-js'

const convertCnToTw = OpenCC.Converter({ from: 'cn', to: 'tw' })

export function simplifiedToTraditional(input: string): string {
  if (!input) return input
  try {
    return convertCnToTw(input)
  } catch {
    return input
  }
}

/**
 * Anime1 search variants: traditional first (required), then original if different.
 * Never send half-converted mixed strings — OpenCC converts the whole string.
 */
export function keywordVariantsZh(keyword: string): string[] {
  const raw = keyword.trim().replace(/\s+/g, ' ')
  if (!raw) return []
  const trad = simplifiedToTraditional(raw).trim()
  const out: string[] = []
  const push = (s: string) => {
    if (s && !out.includes(s)) out.push(s)
  }
  // Always try full traditional first for anime1
  push(trad)
  push(raw)
  // Short head without season suffix (第二季 / 第2季) often matches series pages better
  const stripped = trad
    .replace(/\s*第\s*[一二三四五六七八九十\d]+\s*季\s*$/u, '')
    .replace(/\s*第\s*[一二三四五六七八九十\d]+\s*期\s*$/u, '')
    .replace(/\s*S\d+\s*$/i, '')
    .trim()
  if (stripped && stripped !== trad) push(stripped)
  return out
}
