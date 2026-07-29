/**
 * 封面图片源：构建期默认值（`VITE_BANGUMI_IMAGE_HOST`）+ 设置页可覆盖。
 * 导入时立刻写进 shared 状态，保证 store 水合前的首屏也用对源。
 */
import {
  BANGUMI_IMAGE_HOST_MIRROR,
  BANGUMI_IMAGE_HOST_BANGUMI,
  normalizeBangumiImageHost,
  setBangumiImageHost,
} from '@animaku/shared'

/** `.env` 里的默认源；缺省用镜像。 */
export const DEFAULT_BANGUMI_IMAGE_HOST =
  normalizeBangumiImageHost(
    import.meta.env.VITE_BANGUMI_IMAGE_HOST as string | undefined,
  ) || BANGUMI_IMAGE_HOST_MIRROR

export const BANGUMI_IMAGE_HOST_OPTIONS = [
  { host: BANGUMI_IMAGE_HOST_MIRROR, label: '镜像' },
  { host: BANGUMI_IMAGE_HOST_BANGUMI, label: 'Bangumi' },
]

/** 校验设置里存的值；非法回落到 .env 默认。 */
export function resolveBangumiImageHost(raw?: unknown): string {
  const h = normalizeBangumiImageHost(typeof raw === 'string' ? raw : '')
  return BANGUMI_IMAGE_HOST_OPTIONS.some((o) => o.host === h)
    ? h
    : DEFAULT_BANGUMI_IMAGE_HOST
}

setBangumiImageHost(DEFAULT_BANGUMI_IMAGE_HOST)
