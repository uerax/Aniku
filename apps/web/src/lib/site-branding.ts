/**
 * Site footer / about branding — build-time env (VITE_*), safe defaults for this repo.
 * Deployers fill maintainer fields in `.env` without code changes.
 */

function trimUrl(raw: string | undefined): string {
  const s = (raw || '').trim()
  if (!s) return ''
  // Allow bare github.com/owner/repo
  if (/^https?:\/\//i.test(s)) return s.replace(/\/+$/, '')
  if (/^github\.com\//i.test(s)) return `https://${s}`.replace(/\/+$/, '')
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) return `https://github.com/${s}`
  return s.replace(/\/+$/, '')
}

function trimText(raw: string | undefined): string {
  return (raw || '').trim()
}

/** Default public repo (matches origin remote when unset). */
const DEFAULT_GITHUB_URL = 'https://github.com/uerax/Animaku'

export type SiteBranding = {
  /** Project source — always preferred for “Star / Source” */
  githubUrl: string
  githubLabel: string
  /** Short product blurb under the name */
  tagline: string
  /** Display name in footer */
  productName: string
  maintainerName: string
  /** Profile / homepage for the maintainer line */
  maintainerUrl: string
  /** Extra personal / project homepage (docs, blog, status) */
  homepageUrl: string
  homepageLabel: string
  contactEmail: string
  /** Optional free-form line (e.g. “自托管 · 非官方”) */
  extraNote: string
}

export function getSiteBranding(): SiteBranding {
  const env = import.meta.env
  return {
    githubUrl:
      trimUrl(env.VITE_GITHUB_URL as string | undefined) || DEFAULT_GITHUB_URL,
    githubLabel: trimText(env.VITE_GITHUB_LABEL as string | undefined) || 'GitHub',
    tagline:
      trimText(env.VITE_SITE_TAGLINE as string | undefined) ||
      '在线弹幕播放',
    productName:
      trimText(env.VITE_PRODUCT_NAME as string | undefined) || 'Animaku',
    maintainerName: trimText(env.VITE_MAINTAINER_NAME as string | undefined),
    maintainerUrl: trimUrl(env.VITE_MAINTAINER_URL as string | undefined),
    homepageUrl: trimUrl(env.VITE_HOMEPAGE_URL as string | undefined),
    homepageLabel:
      trimText(env.VITE_HOMEPAGE_LABEL as string | undefined) || '主页',
    contactEmail: trimText(env.VITE_CONTACT_EMAIL as string | undefined),
    extraNote: trimText(env.VITE_FOOTER_NOTE as string | undefined),
  }
}

