/**
 * One-click rule smoke test: search → chapters → resolve.
 * Keywords are fixed (no user input); first hit that yields chapters wins.
 */

import type { PluginRule } from '@aniku/shared'
import { pluginApi } from './plugin-api'

/** Common titles most anime indexes still list; try in order until search hits. */
export const SMOKE_KEYWORDS = [
  '进击的巨人',
  '鬼灭之刃',
  '间谍过家家',
  '芙莉莲',
] as const

export type SmokeStepStatus = 'pending' | 'ok' | 'fail' | 'skip'

export interface SmokeStep {
  key: 'search' | 'chapters' | 'resolve'
  label: string
  status: SmokeStepStatus
  detail: string
}

export interface SmokeReport {
  pluginName: string
  ok: boolean
  keywordUsed?: string
  steps: SmokeStep[]
  /** One-line summary for list row */
  summary: string
  /** Multi-line detail for expanded panel */
  detail: string
  finishedAt: number
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function shortUrl(u: string, max = 64): string {
  if (u.length <= max) return u
  return `${u.slice(0, max - 1)}…`
}

/**
 * Run automatic pipeline smoke for one rule.
 * Does not throw — failures are encoded in the report.
 */
export async function runPluginSmoke(
  rule: PluginRule,
  opts?: { signal?: AbortSignal },
): Promise<SmokeReport> {
  const name = rule.name || '规则'
  const steps: SmokeStep[] = [
    { key: 'search', label: '搜索', status: 'pending', detail: '' },
    { key: 'chapters', label: '分集', status: 'pending', detail: '' },
    { key: 'resolve', label: '解析', status: 'pending', detail: '' },
  ]

  const aborted = () => opts?.signal?.aborted

  let keywordUsed: string | undefined
  let firstSrc = ''
  let firstTitle = ''
  let searchDiag: string[] = []

  // ── 1. Search ──────────────────────────────────────────
  try {
    let lastDiag: string[] = []
    let hitCount = 0
    for (const kw of SMOKE_KEYWORDS) {
      if (aborted()) throw new Error('已取消')
      const res = await pluginApi.search(rule, kw)
      lastDiag = res.data.diagnostics || []
      const items = res.data.items || []
      hitCount = items.length
      if (items.length > 0) {
        keywordUsed = kw
        firstSrc = (items[0]!.src || '').trim()
        firstTitle = (items[0]!.name || '').trim()
        steps[0] = {
          key: 'search',
          label: '搜索',
          status: 'ok',
          detail: `「${kw}」→ ${items.length} 条，首条「${firstTitle || shortUrl(firstSrc)}」`,
        }
        searchDiag = lastDiag
        break
      }
    }
    if (steps[0]!.status !== 'ok') {
      steps[0] = {
        key: 'search',
        label: '搜索',
        status: 'fail',
        detail:
          hitCount === 0
            ? `内置关键词均无结果${lastDiag.length ? `（${lastDiag.slice(0, 2).join('；')}）` : ''}`
            : '无有效条目',
      }
      steps[1] = {
        key: 'chapters',
        label: '分集',
        status: 'skip',
        detail: '跳过（搜索无结果）',
      }
      steps[2] = {
        key: 'resolve',
        label: '解析',
        status: 'skip',
        detail: '跳过（搜索无结果）',
      }
      return finish(name, false, keywordUsed, steps, searchDiag)
    }
  } catch (e) {
    steps[0] = {
      key: 'search',
      label: '搜索',
      status: 'fail',
      detail: errMsg(e),
    }
    steps[1] = {
      key: 'chapters',
      label: '分集',
      status: 'skip',
      detail: '跳过',
    }
    steps[2] = {
      key: 'resolve',
      label: '解析',
      status: 'skip',
      detail: '跳过',
    }
    return finish(name, false, keywordUsed, steps)
  }

  if (!firstSrc) {
    steps[1] = {
      key: 'chapters',
      label: '分集',
      status: 'fail',
      detail: '首条结果无详情链接',
    }
    steps[2] = {
      key: 'resolve',
      label: '解析',
      status: 'skip',
      detail: '跳过',
    }
    return finish(name, false, keywordUsed, steps, searchDiag)
  }

  // ── 2. Chapters ────────────────────────────────────────
  let epUrl = ''
  let chapterDiag: string[] = []
  try {
    if (aborted()) throw new Error('已取消')
    const ch = await pluginApi.chapters(rule, firstSrc)
    chapterDiag = ch.data.diagnostics || []
    const roads = ch.data.roads || []
    const totalEps = roads.reduce(
      (n, r) => n + (Array.isArray(r.data) ? r.data.length : 0),
      0,
    )
    // Episode list is string[] of absolute play-page URLs
    const pickEp = (): string => {
      for (const road of roads) {
        for (const item of road.data || []) {
          if (typeof item === 'string' && item.trim()) return item.trim()
        }
      }
      return ''
    }
    epUrl = pickEp()
    if (!roads.length || totalEps === 0) {
      steps[1] = {
        key: 'chapters',
        label: '分集',
        status: 'fail',
        detail: `0 线 / 0 集${chapterDiag.length ? `（${chapterDiag.slice(0, 2).join('；')}）` : ''}`,
      }
      steps[2] = {
        key: 'resolve',
        label: '解析',
        status: 'skip',
        detail: '跳过（无分集）',
      }
      return finish(name, false, keywordUsed, steps, [
        ...searchDiag,
        ...chapterDiag,
      ])
    }
    const roadSummary = roads
      .slice(0, 4)
      .map((r) => `${r.name || '线'}:${(r.data || []).length}`)
      .join(' · ')
    steps[1] = {
      key: 'chapters',
      label: '分集',
      status: 'ok',
      detail: `${roads.length} 线 / 共 ${totalEps} 集（${roadSummary}）`,
    }
  } catch (e) {
    steps[1] = {
      key: 'chapters',
      label: '分集',
      status: 'fail',
      detail: errMsg(e),
    }
    steps[2] = {
      key: 'resolve',
      label: '解析',
      status: 'skip',
      detail: '跳过',
    }
    return finish(name, false, keywordUsed, steps, searchDiag)
  }

  // ── 3. Resolve ─────────────────────────────────────────
  try {
    if (aborted()) throw new Error('已取消')
    if (!epUrl) {
      steps[2] = {
        key: 'resolve',
        label: '解析',
        status: 'fail',
        detail: '分集列表无播放页 URL',
      }
      return finish(name, false, keywordUsed, steps, [
        ...searchDiag,
        ...chapterDiag,
      ])
    }
    const r = await pluginApi.resolve(rule, epUrl)
    const play = r.data.playUrl || ''
    const proxy = r.data.proxyUrl || ''
    const kind = /\.m3u8($|[?#])/i.test(play)
      ? 'm3u8'
      : /\.mp4($|[?#])/i.test(play)
        ? 'mp4'
        : play
          ? 'media'
          : '无地址'
    const ad =
      /[?&]adFilter=1(?:&|$)/.test(proxy) ||
      /[?&]adFilter=true(?:&|$)/.test(proxy)
    steps[2] = {
      key: 'resolve',
      label: '解析',
      status: play ? 'ok' : 'fail',
      detail: play
        ? `${kind}${ad ? ' · adFilter' : ''} · ${shortUrl(play, 72)}`
        : '未解析到播放地址',
    }
    const ok = steps.every((s) => s.status === 'ok' || s.status === 'skip')
      && steps[0]!.status === 'ok'
      && steps[1]!.status === 'ok'
      && steps[2]!.status === 'ok'
    return finish(name, ok, keywordUsed, steps, [
      ...searchDiag,
      ...chapterDiag,
      ...(r.data.diagnostics || []),
    ])
  } catch (e) {
    steps[2] = {
      key: 'resolve',
      label: '解析',
      status: 'fail',
      detail: errMsg(e),
    }
    return finish(name, false, keywordUsed, steps, [
      ...searchDiag,
      ...chapterDiag,
    ])
  }
}

function finish(
  pluginName: string,
  ok: boolean,
  keywordUsed: string | undefined,
  steps: SmokeStep[],
  extraDiag: string[] = [],
): SmokeReport {
  const mark = (s: SmokeStepStatus) =>
    s === 'ok' ? '✓' : s === 'fail' ? '✗' : s === 'skip' ? '–' : '…'
  const summaryParts = steps.map(
    (s) => `${mark(s.status)}${s.label}`,
  )
  const summary = ok
    ? `通过 · ${summaryParts.join(' ')}`
    : `未通过 · ${summaryParts.join(' ')}`

  const lines: string[] = [
    `${pluginName} 冒烟${ok ? '通过' : '未通过'}`,
    keywordUsed ? `关键词：${keywordUsed}（内置自动）` : '关键词：内置列表均无命中',
    ...steps.map((s) => `  ${mark(s.status)} ${s.label}：${s.detail || s.status}`),
  ]
  const diag = extraDiag.filter(Boolean).slice(0, 6)
  if (diag.length) {
    lines.push('诊断：')
    for (const d of diag) lines.push(`  · ${d}`)
  }

  return {
    pluginName,
    ok,
    keywordUsed,
    steps,
    summary,
    detail: lines.join('\n'),
    finishedAt: Date.now(),
  }
}
