/**
 * Host-aware robots.txt + sitemap.xml for production SPA hosting.
 * Static copies also live in apps/web/public/ (dev / pure static); server
 * responses win when registered before serveStatic.
 */

const SITEMAP_PATHS = ['/', '/anime', '/timeline'] as const

/** Prefer SITE_URL, else request Host (+ X-Forwarded-*). */
export function resolvePublicOrigin(
  siteUrlConfig: string,
  req: {
    header: (name: string) => string | undefined
    url: string
  },
): string {
  const configured = siteUrlConfig.trim().replace(/\/+$/, '')
  if (configured) return configured

  const xfProto = (req.header('x-forwarded-proto') || '')
    .split(',')[0]
    ?.trim()
  const xfHost = (req.header('x-forwarded-host') || '')
    .split(',')[0]
    ?.trim()
  const host = xfHost || req.header('host') || ''
  if (!host) return ''

  let proto = xfProto || ''
  if (!proto) {
    try {
      proto = new URL(req.url).protocol.replace(':', '')
    } catch {
      proto = 'http'
    }
  }
  if (proto !== 'http' && proto !== 'https') proto = 'https'
  return `${proto}://${host}`.replace(/\/+$/, '')
}

export function buildRobotsTxt(origin: string): string {
  const sitemapLine = origin
    ? `Sitemap: ${origin}/sitemap.xml\n`
    : '# Set SITE_URL or open via public Host so Sitemap: can be absolute\n'

  return `# Animaku robots
User-agent: *
Allow: /
Allow: /anime
Allow: /timeline
Allow: /subject/

Disallow: /api/
Disallow: /settings
Disallow: /history
Disallow: /collect
Disallow: /play/
Disallow: /search

Allow: /assets/

${sitemapLine}`
}

export function buildSitemapXml(origin: string, lastmod = new Date()): string {
  const base = origin.replace(/\/+$/, '') || ''
  const day = lastmod.toISOString().slice(0, 10)
  const urls = SITEMAP_PATHS.map((path) => {
    const loc = base ? `${base}${path === '/' ? '/' : path}` : path
    const priority = path === '/' ? '1.0' : '0.8'
    const changefreq = path === '/timeline' ? 'daily' : 'weekly'
    return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <lastmod>${day}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
