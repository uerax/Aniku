/**
 * Bangumi 图片源主机切换。
 *
 * Bangumi API 与镜像使用相同的图片 path（含 `/r/{edge}/pic/` 缩放），
 * 因此切换图片源时只替换 host。
 *
 * 用模块级状态而不是参数透传：`coverOf` 被组件、SEO、历史记录等非 React 处共用。
 * Web 端在 settings store 里调用 `setBangumiImageHost`（先改这里，再 set 触发渲染）。
 */

export const BANGUMI_IMAGE_HOST_BANGUMI = 'lain.bgm.tv'
export const BANGUMI_IMAGE_HOST_MIRROR = 'bgmimg.anibt.net'

/** 可改写的已知图片 host —— 其它 host（插件站图等）原样返回。 */
const REWRITABLE_HOSTS = new Set([
  BANGUMI_IMAGE_HOST_BANGUMI,
  BANGUMI_IMAGE_HOST_MIRROR,
  'bgm.tv',
  'www.bgm.tv',
])

/** 容忍 `https://host/`、`host/path` 之类输入。 */
export function normalizeBangumiImageHost(raw?: string | null): string {
  return (raw || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
}

let currentHost: string = BANGUMI_IMAGE_HOST_MIRROR

export function setBangumiImageHost(host?: string | null): void {
  currentHost = normalizeBangumiImageHost(host) || BANGUMI_IMAGE_HOST_MIRROR
}

export function getBangumiImageHost(): string {
  return currentHost
}

/** 把已知 Bangumi 图片 host 换成当前源；其它 host / 相对路径原样返回。 */
export function bangumiImageUrl(url: string): string {
  const src = (url || '').trim()
  if (!src) return ''
  const m = /^(https?:)\/\/([^/?#]+)(.*)$/i.exec(src)
  if (!m) return src
  const host = m[2].toLowerCase()
  if (host === currentHost || !REWRITABLE_HOSTS.has(host)) return src
  return `${m[1]}//${currentHost}${m[3]}`
}
