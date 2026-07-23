import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return
  const text = readFileSync(filePath, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

// cwd is typically apps/server when running via pnpm filter
loadEnvFile(resolve(process.cwd(), '../../.env'))
loadEnvFile(resolve(process.cwd(), '.env'))
loadEnvFile(resolve(import.meta.dirname, '../../../.env'))
loadEnvFile(resolve(import.meta.dirname, '../../.env'))

function envInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function envBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback
  const v = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(v)) return true
  if (['0', 'false', 'no', 'off'].includes(v)) return false
  return fallback
}

/** Comma-separated Origin list; empty → built-in localhost allowlist only */
function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export const config = {
  /** API listen port — `PORT` in root `.env` */
  port: envInt(process.env.PORT, 8787),
  /** API bind host — `HOST` in root `.env` */
  host: process.env.HOST || '0.0.0.0',
  /**
   * Extra browser Origins allowed by CORS (comma-separated).
   * Always allows same-origin (no Origin) + localhost / 127.0.0.1 any port.
   * Set CORS_ORIGINS=* only if you intentionally want open cross-origin (not recommended).
   */
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
  corsOpen: (process.env.CORS_ORIGINS || '').trim() === '*',
  /**
   * When false (default): /api/media/proxy and plugin search/chapters/resolve
   * only accept loopback / private-network clients (LAN Docker OK; public Internet blocked).
   * Set PUBLIC_PROXY=1 for intentional public deploy (still has SSRF host checks).
   */
  publicProxy: envBool(process.env.PUBLIC_PROXY, false),
  /**
   * Optional shared secret. When set, media + plugin exec also accept
   * `X-Aniku-Proxy-Token: <token>` even from public IPs.
   */
  proxyToken: (process.env.PROXY_TOKEN || '').trim(),
  dandanAppId: process.env.DANDAN_APP_ID || '',
  dandanAppSecret: process.env.DANDAN_APP_SECRET || '',
  bangumiUserAgent:
    process.env.BANGUMI_USER_AGENT || 'aniku/0.1',
  /** Product UA for APIs that expect an app identity (e.g. DanDanPlay) */
  productUserAgent: process.env.PRODUCT_USER_AGENT || 'aniku/0.1',
  defaultUserAgent:
    process.env.DEFAULT_USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  bangumiApi: 'https://api.bgm.tv',
  bangumiNextApi: 'https://next.bgm.tv',
  dandanApi: 'https://api.dandanplay.net',
  /** KazumiRules primary + gitcode mirror (same as Kazumi ApiEndpoints) */
  pluginShop:
    process.env.PLUGIN_SHOP ||
    'https://raw.githubusercontent.com/Predidit/KazumiRules/main/',
  pluginShopMirror:
    process.env.PLUGIN_SHOP_MIRROR ||
    'https://raw.gitcode.com/gh_mirrors/ka/KazumiRules/raw/main/',
}
