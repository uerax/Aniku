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

export const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '0.0.0.0',
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
