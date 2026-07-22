import { createHash } from 'node:crypto'
import { config } from '../config'

/**
 * agefans-enhance 内置的弹弹客户端凭证（userscript 直连 API 用的同一对）。
 * 未在 .env 配置开放平台密钥时作为本地/开发回退，保证开箱有弹幕。
 * 生产环境建议自行申请：https://www.dandanplay.com/
 */
const FALLBACK_APP_ID = 'hvf6pzvxcm'
const FALLBACK_APP_SECRET = 'IZhcUIakoxFaK9xBBDJ9Bs1OU2s4kK5t'

function resolveCredentials(): {
  appId: string
  appSecret: string
  /** open platform uses X-Auth + timestamp signature; legacy uses AppId+Secret headers */
  mode: 'open' | 'legacy'
} {
  const id = config.dandanAppId.trim()
  const secret = config.dandanAppSecret.trim()
  if (id && secret) {
    // User-supplied pair: prefer open-platform signature auth (official docs).
    // If the pair is the same as agefans fallback, still use legacy headers
    // because those keys work with the simple header scheme.
    if (id === FALLBACK_APP_ID && secret === FALLBACK_APP_SECRET) {
      return { appId: id, appSecret: secret, mode: 'legacy' }
    }
    return { appId: id, appSecret: secret, mode: 'open' }
  }
  return {
    appId: FALLBACK_APP_ID,
    appSecret: FALLBACK_APP_SECRET,
    mode: 'legacy',
  }
}

export function generateDandanSignature(
  path: string,
  timestamp: number,
  appId: string,
  secret: string,
): string {
  const data = `${appId}${timestamp}${path}${secret}`
  return createHash('sha256').update(data, 'utf8').digest('base64')
}

/** Always true now: either user env or agefans-compatible fallback. */
export function assertDanmakuConfigured(): void {
  // no-op: resolveCredentials always returns a usable pair
}

export function isDanmakuUsingFallback(): boolean {
  const id = config.dandanAppId.trim()
  const secret = config.dandanAppSecret.trim()
  return !id || !secret
}

export async function dandanGet(
  path: string,
  query?: Record<string, string>,
): Promise<unknown> {
  const { appId, appSecret, mode } = resolveCredentials()
  const url = new URL(path, config.dandanApi)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v)
    }
  }

  const headers: Record<string, string> = {
    // Identify as Aniku (not a browser scrape UA / not kazumi-web)
    'User-Agent': config.productUserAgent,
    Accept: 'application/json',
  }

  if (mode === 'open') {
    const timestamp = Math.floor(Date.now() / 1000)
    headers['X-Auth'] = '1'
    headers['X-AppId'] = appId
    headers['X-Timestamp'] = String(timestamp)
    headers['X-Signature'] = generateDandanSignature(
      path,
      timestamp,
      appId,
      appSecret,
    )
  } else {
    // Same scheme as agefans-enhance `apis.ts` (GM_xmlhttpRequest headers)
    headers['X-AppId'] = appId
    headers['X-AppSecret'] = appSecret
  }

  const res = await fetch(url, { headers })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`弹弹 API ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}
