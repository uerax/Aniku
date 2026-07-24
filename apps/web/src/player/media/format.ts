export function isM3u8(url: string) {
  try {
    const d = decodeURIComponent(url).toLowerCase()
    return d.includes('.m3u8') || d.includes('mpegurl') || d.includes('m3u8')
  } catch {
    const u = url.toLowerCase()
    return u.includes('.m3u8') || u.includes('mpegurl') || u.includes('m3u8')
  }
}

export function isXmlDanmakuFile(file: File) {
  const name = file.name.toLowerCase()
  return (
    name.endsWith('.xml') ||
    file.type === 'text/xml' ||
    file.type === 'application/xml' ||
    file.type === 'text/plain'
  )
}

export function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const s = Math.floor(sec % 60)
  const m = Math.floor(sec / 60) % 60
  const h = Math.floor(sec / 3600)
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Seconds of media buffered ahead of currentTime (0 if none). */
export function bufferedAhead(video: HTMLVideoElement): number {
  const t = video.currentTime || 0
  try {
    const ranges = video.buffered
    for (let i = 0; i < ranges.length; i++) {
      const start = ranges.start(i)
      const end = ranges.end(i)
      if (t + 0.05 >= start && t <= end + 0.05) {
        return Math.max(0, end - t)
      }
    }
  } catch {
    /* ignore */
  }
  return 0
}
