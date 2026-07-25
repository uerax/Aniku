import type { DanmakuComment, DanmakuSettings } from '@aniku/shared'

/**
 * Pixel speed helpers for canvas (and legacy) danmaku.
 * Canvas engine uses duration = (stageW + textW) / speed → constant visual px/s.
 */
export const BASE_DANMAKU_SPEED = 130

/**
 * Base size ~B 站默认 25px at a mid-size player; user fontSize is a multiplier.
 * Small / phone windowed players scale down so 25px doesn't dominate the frame.
 */
const DANMAKU_REF_WIDTH = 720
const DANMAKU_MIN_SCALE = 0.48 // ~12px @ default multiplier
const DANMAKU_MAX_SCALE = 1.1

type CompiledFilter =
  | { kind: 're'; re: RegExp }
  | { kind: 'sub'; text: string }

/** Compile keyword filters once per settings change (not per comment). */
function compileFilters(filters: string[] | undefined): CompiledFilter[] {
  const out: CompiledFilter[] = []
  if (!filters?.length) return out
  for (const rule of filters) {
    if (!rule) continue
    if (rule.startsWith('/') && rule.lastIndexOf('/') > 0) {
      try {
        const body = rule.slice(1, rule.lastIndexOf('/'))
        const flags = rule.slice(rule.lastIndexOf('/') + 1)
        out.push({ kind: 're', re: new RegExp(body, flags) })
      } catch {
        /* ignore bad regex */
      }
    } else {
      out.push({ kind: 'sub', text: rule })
    }
  }
  return out
}

export function filterComments(
  comments: DanmakuComment[],
  settings: DanmakuSettings,
): DanmakuComment[] {
  const compiled = compileFilters(settings.filters)
  return comments.filter((c) => {
    if (!settings.showScroll && c.mode === 'rtl') return false
    if (!settings.showTop && c.mode === 'top') return false
    if (!settings.showBottom && c.mode === 'bottom') return false
    if (
      !settings.showColor &&
      c.style?.color &&
      c.style.color.toLowerCase() !== '#ffffff'
    ) {
      return false
    }
    for (const f of compiled) {
      if (f.kind === 're') {
        if (f.re.test(c.text)) return false
      } else if (c.text.includes(f.text)) {
        return false
      }
    }
    return true
  })
}

export function danmakuFontScale(containerWidth: number): number {
  if (!(containerWidth > 0)) return 1
  return Math.min(
    DANMAKU_MAX_SCALE,
    Math.max(DANMAKU_MIN_SCALE, containerWidth / DANMAKU_REF_WIDTH),
  )
}

/** Pixel speed for scroll comments; slower on narrow stages, × user multiplier. */
export function danmakuPixelSpeed(
  containerWidth: number,
  userSpeed: number,
): number {
  const mult = userSpeed > 0 ? userSpeed : 1
  const w = containerWidth > 0 ? containerWidth : DANMAKU_REF_WIDTH
  // Cap at 1: never faster than desktop base for the same user multiplier
  const scale = Math.min(1, Math.max(0.45, w / DANMAKU_REF_WIDTH))
  return Math.max(40, BASE_DANMAKU_SPEED * scale * mult)
}
