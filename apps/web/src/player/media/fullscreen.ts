/**
 * Fullscreen helpers — iOS Safari has no Element.requestFullscreen for divs.
 */

type FsEl = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
  webkitRequestFullScreen?: () => Promise<void> | void
  webkitExitFullscreen?: () => Promise<void> | void
}

type FsDoc = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
  webkitCancelFullScreen?: () => Promise<void> | void
}

type IosVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void
  webkitExitFullscreen?: () => void
  webkitDisplayingFullscreen?: boolean
  webkitSupportsFullscreen?: boolean
}

export function getFullscreenElement(): Element | null {
  const d = document as FsDoc
  return document.fullscreenElement ?? d.webkitFullscreenElement ?? null
}

export function isShellFullscreen(shell: HTMLElement | null): boolean {
  if (!shell) return false
  return getFullscreenElement() === shell
}

export function canRequestDomFullscreen(el: HTMLElement): boolean {
  const e = el as FsEl
  return Boolean(
    e.requestFullscreen || e.webkitRequestFullscreen || e.webkitRequestFullScreen,
  )
}

export async function requestDomFullscreen(el: HTMLElement): Promise<void> {
  const e = el as FsEl
  if (e.requestFullscreen) {
    await e.requestFullscreen()
    return
  }
  if (e.webkitRequestFullscreen) {
    await e.webkitRequestFullscreen()
    return
  }
  if (e.webkitRequestFullScreen) {
    await e.webkitRequestFullScreen()
    return
  }
  throw new Error('Fullscreen API not available')
}

export async function exitDomFullscreen(): Promise<void> {
  const d = document as FsDoc
  if (!getFullscreenElement()) return
  if (document.exitFullscreen) {
    await document.exitFullscreen()
    return
  }
  if (d.webkitExitFullscreen) {
    await d.webkitExitFullscreen()
    return
  }
  if (d.webkitCancelFullScreen) {
    await d.webkitCancelFullScreen()
  }
}

export function canIosVideoFullscreen(video: HTMLVideoElement | null): boolean {
  if (!video) return false
  const v = video as IosVideo
  // iPhone: webkitEnterFullscreen exists; webkitSupportsFullscreen may be true
  return typeof v.webkitEnterFullscreen === 'function'
}

export function isIosVideoFullscreen(video: HTMLVideoElement | null): boolean {
  if (!video) return false
  return Boolean((video as IosVideo).webkitDisplayingFullscreen)
}

export function enterIosVideoFullscreen(video: HTMLVideoElement): void {
  const v = video as IosVideo
  v.webkitEnterFullscreen?.()
}

export function exitIosVideoFullscreen(video: HTMLVideoElement | null): void {
  if (!video) return
  const v = video as IosVideo
  if (v.webkitDisplayingFullscreen) {
    try {
      v.webkitExitFullscreen?.()
    } catch {
      /* ignore */
    }
  }
}
