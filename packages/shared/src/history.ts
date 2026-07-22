export interface WatchHistoryEntry {
  id: string
  bangumiId: number
  title: string
  cover?: string
  episode: number
  road: number
  pluginName: string
  pageUrl: string
  playUrl?: string
  position: number
  duration: number
  updatedAt: number
}

export function historyId(
  bangumiId: number,
  pluginName: string,
  episode: number,
  road: number,
): string {
  return `${bangumiId}::${pluginName}::${road}::${episode}`
}
