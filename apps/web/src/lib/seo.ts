/**
 * Client-side document SEO helpers for the SPA.
 *
 * Crawlers that only fetch raw HTML still see index.html defaults.
 * Google (and similar) that run JS pick up title / meta / JSON-LD updates here.
 * Absolute OG / canonical URLs need VITE_SITE_URL (or runtime origin fallback).
 */

export const SITE_NAME = 'Animaku'

export const DEFAULT_DESCRIPTION =
  'Animaku — 浏览器端番剧客户端：Bangumi 元数据、规则选源播放、弹幕与本地追番历史。自托管，兼容 KazumiRules。'

/** Max length for meta description (search engines typically show ~150–160). */
const DESC_MAX = 160

export type SeoRobots = 'index,follow' | 'noindex,follow' | 'noindex,nofollow'

export type PageSeo = {
  /** Browser tab + og:title base (product name appended unless already present) */
  title: string
  description?: string
  /** Absolute or site-relative image URL for og:image */
  image?: string
  /** Path only, e.g. /anime — used for canonical / og:url */
  path?: string
  robots?: SeoRobots
  /** Optional JSON-LD object or list (serialized into application/ld+json) */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[]
}

/** Static route SEO (exact path, query ignored except search). */
export const STATIC_ROUTE_SEO: Record<
  string,
  Omit<PageSeo, 'path' | 'image' | 'jsonLd'>
> = {
  '/': {
    title: '发现',
    description:
      '浏览 Bangumi 动画趋势，继续观看本地历史，进入详情后用自定义规则选源播放。',
  },
  '/anime': {
    title: '番剧目录',
    description: '按标签与排序浏览 Bangumi 动画目录，点击进入详情与选源播放。',
  },
  '/timeline': {
    title: '放送时间表',
    description: '按星期查看 Bangumi 放送时间表，快速找到今日更新的动画。',
  },
  '/search': {
    title: '搜索',
    description: '在 Bangumi 中搜索动画，进入详情后选源播放。',
    robots: 'noindex,follow',
  },
  '/collect': {
    title: '追番',
    description: 'Bangumi 收藏同步（需 Token）。本地私有列表，不对搜索引擎开放。',
    robots: 'noindex,nofollow',
  },
  '/history': {
    title: '观看历史',
    description: '本地浏览器保存的播放进度，不对搜索引擎开放。',
    robots: 'noindex,nofollow',
  },
  '/settings': {
    title: '设置',
    description: '规则、播放器、弹幕与账号相关设置。',
    robots: 'noindex,nofollow',
  },
}

/** Public paths listed in sitemap (no private / thin pages). */
export const SITEMAP_PATHS = ['/', '/anime', '/timeline'] as const

export function truncateDescription(text: string, max = DESC_MAX): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const sp = cut.lastIndexOf(' ')
  return `${(sp > 40 ? cut.slice(0, sp) : cut).trim()}…`
}

export function formatDocumentTitle(pageTitle: string, siteName = SITE_NAME): string {
  const t = pageTitle.trim()
  if (!t || t === siteName) return siteName
  if (t.includes(siteName)) return t
  return `${t} · ${siteName}`
}

/** Prefer build-time public site URL; fall back to browser origin. */
export function resolveSiteUrl(): string {
  const fromEnv = (import.meta.env.VITE_SITE_URL as string | undefined)?.trim()
  if (fromEnv) return fromEnv.replace(/\/+$/, '')
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '')
  }
  return ''
}

export function toAbsoluteUrl(pathOrUrl: string, siteUrl = resolveSiteUrl()): string {
  const raw = (pathOrUrl || '').trim()
  if (!raw) return siteUrl || ''
  if (/^https?:\/\//i.test(raw)) return raw
  if (!siteUrl) return raw.startsWith('/') ? raw : `/${raw}`
  const path = raw.startsWith('/') ? raw : `/${raw}`
  return `${siteUrl}${path}`
}

function ensureMetaByName(name: string, content: string) {
  let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('name', name)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function ensureMetaByProperty(property: string, content: string) {
  let el = document.querySelector(
    `meta[property="${property}"]`,
  ) as HTMLMetaElement | null
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('property', property)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function ensureLinkRel(rel: string, href: string) {
  let el = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', rel)
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

const JSON_LD_ATTR = 'data-animaku-jsonld'

function applyJsonLd(data: PageSeo['jsonLd']) {
  document
    .querySelectorAll(`script[${JSON_LD_ATTR}]`)
    .forEach((n) => n.parentNode?.removeChild(n))
  if (!data) return
  const list = Array.isArray(data) ? data : [data]
  for (const item of list) {
    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.setAttribute(JSON_LD_ATTR, '1')
    script.textContent = JSON.stringify(item)
    document.head.appendChild(script)
  }
}

/**
 * Apply title + meta + optional JSON-LD to document.head.
 * Safe to call on every navigation; overwrites previous SEO tags we manage.
 */
export function applyPageSeo(seo: PageSeo): void {
  if (typeof document === 'undefined') return

  const title = formatDocumentTitle(seo.title)
  const description = truncateDescription(
    seo.description?.trim() || DEFAULT_DESCRIPTION,
  )
  const robots = seo.robots || 'index,follow'
  const siteUrl = resolveSiteUrl()
  const path = seo.path || (typeof window !== 'undefined' ? window.location.pathname : '/')
  const pageUrl = toAbsoluteUrl(path, siteUrl)
  const image = seo.image
    ? toAbsoluteUrl(seo.image, siteUrl)
    : toAbsoluteUrl('/android-chrome-512x512.png', siteUrl)

  document.title = title

  ensureMetaByName('description', description)
  ensureMetaByName('robots', robots)
  ensureMetaByName('application-name', SITE_NAME)

  // Open Graph — TVSeries pages use video.tv_show; everything else website
  const isSubjectPath =
    path.startsWith('/subject/') || path.startsWith('/play/')
  ensureMetaByProperty('og:type', isSubjectPath ? 'video.tv_show' : 'website')
  ensureMetaByProperty('og:site_name', SITE_NAME)
  ensureMetaByProperty('og:title', title)
  ensureMetaByProperty('og:description', description)
  if (pageUrl) ensureMetaByProperty('og:url', pageUrl)
  if (image) ensureMetaByProperty('og:image', image)
  ensureMetaByProperty('og:locale', 'zh_CN')

  // Twitter
  ensureMetaByName('twitter:card', image ? 'summary_large_image' : 'summary')
  ensureMetaByName('twitter:title', title)
  ensureMetaByName('twitter:description', description)
  if (image) ensureMetaByName('twitter:image', image)

  if (pageUrl && robots.startsWith('index')) {
    ensureLinkRel('canonical', pageUrl)
  } else {
    const canon = document.querySelector('link[rel="canonical"]')
    canon?.parentNode?.removeChild(canon)
  }

  applyJsonLd(seo.jsonLd)
}

export function buildWebsiteJsonLd(siteUrl = resolveSiteUrl()): Record<string, unknown> {
  const url = siteUrl || undefined
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    ...(url ? { url } : {}),
    // Absolute SearchAction only when we know the public origin
    ...(url
      ? {
          potentialAction: {
            '@type': 'SearchAction',
            target: {
              '@type': 'EntryPoint',
              urlTemplate: `${url}/search?q={search_term_string}`,
            },
            'query-input': 'required name=search_term_string',
          },
        }
      : {}),
  }
}

export function buildTvSeriesJsonLd(args: {
  id: number
  name: string
  alternateName?: string
  description?: string
  image?: string
  datePublished?: string
  path: string
}): Record<string, unknown> {
  const siteUrl = resolveSiteUrl()
  return {
    '@context': 'https://schema.org',
    '@type': 'TVSeries',
    name: args.name,
    ...(args.alternateName && args.alternateName !== args.name
      ? { alternateName: args.alternateName }
      : {}),
    ...(args.description ? { description: truncateDescription(args.description, 300) } : {}),
    ...(args.image ? { image: toAbsoluteUrl(args.image, siteUrl) } : {}),
    ...(args.datePublished ? { datePublished: args.datePublished } : {}),
    url: toAbsoluteUrl(args.path, siteUrl),
    identifier: String(args.id),
  }
}
