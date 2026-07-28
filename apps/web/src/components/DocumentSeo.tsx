import { useEffect, useMemo } from 'react'
import { matchPath, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { coverOf } from '@animaku/shared'
import { bangumiApi } from '../lib/bangumi'
import {
  STATIC_ROUTE_SEO,
  applyPageSeo,
  buildTvSeriesJsonLd,
  buildWebsiteJsonLd,
  DEFAULT_DESCRIPTION,
  type PageSeo,
} from '../lib/seo'

/**
 * Keeps <title> / meta / JSON-LD in sync with the current client route.
 * Mount once under the router (Layout).
 */
export function DocumentSeo() {
  const { pathname, search } = useLocation()

  const subjectMatch = matchPath(
    { path: '/subject/:id', end: true },
    pathname,
  )
  const playMatch = matchPath({ path: '/play/:id', end: true }, pathname)
  const subjectId = Number(
    subjectMatch?.params.id || playMatch?.params.id || 0,
  )
  const onSubject = Number.isFinite(subjectId) && subjectId > 0
  /** /play is a cinema alias — canonical + index only on /subject/:id */
  const isPlayAlias = Boolean(playMatch)

  const subject = useQuery({
    queryKey: ['subject', subjectId],
    queryFn: ({ signal }) => bangumiApi.subject(subjectId, { signal }),
    enabled: onSubject,
    staleTime: 30 * 60_000,
    gcTime: 6 * 60 * 60_000,
  })

  const seo: PageSeo = useMemo(() => {
    if (onSubject) {
      const item = subject.data?.data
      const name = item
        ? item.nameCn || item.name || `番剧 ${subjectId}`
        : subject.isError
          ? `番剧 ${subjectId}`
          : '加载中…'
      const alt =
        item && item.nameCn && item.name && item.nameCn !== item.name
          ? item.name
          : undefined
      const summary = item?.summary?.trim()
      const description = summary
        ? summary
        : `${name} — 在 Animaku 查看 Bangumi 资料并选源播放`
      const cover = item ? coverOf(item, 'large') || coverOf(item) : ''
      // Always canonicalize to /subject/:id (even when user is on /play/:id)
      const path = `/subject/${subjectId}`
      const indexable =
        !isPlayAlias && Boolean(item || subject.isError)
      return {
        title: name,
        description,
        image: cover || undefined,
        path,
        robots: indexable ? 'index,follow' : 'noindex,follow',
        jsonLd:
          item && !isPlayAlias
            ? buildTvSeriesJsonLd({
                id: subjectId,
                name: item.nameCn || item.name,
                alternateName: alt,
                description: summary,
                image: cover || undefined,
                datePublished: item.airDate || undefined,
                path,
              })
            : undefined,
      }
    }

    // /search?q=… — keep noindex; reflect keyword in title for tabs
    if (pathname === '/search') {
      const q = new URLSearchParams(search).get('q')?.trim() || ''
      const base = STATIC_ROUTE_SEO['/search']
      return {
        ...base,
        title: q ? `搜索「${q}」` : base.title,
        path: '/search',
        description: q
          ? `Bangumi 搜索「${q}」的结果 — Animaku`
          : base.description,
      }
    }

    const staticSeo = STATIC_ROUTE_SEO[pathname]
    if (staticSeo) {
      return {
        ...staticSeo,
        path: pathname,
        jsonLd: pathname === '/' ? buildWebsiteJsonLd() : undefined,
      }
    }

    return {
      title: 'Animaku',
      description: DEFAULT_DESCRIPTION,
      path: pathname,
      robots: 'noindex,follow',
    }
  }, [
    isPlayAlias,
    onSubject,
    pathname,
    search,
    subject.data,
    subject.isError,
    subjectId,
  ])

  useEffect(() => {
    applyPageSeo(seo)
  }, [seo])

  return null
}
