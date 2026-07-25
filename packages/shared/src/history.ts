export interface WatchHistoryEntry {
  id: string
  bangumiId: number
  title: string
  cover?: string
  episode: number
  road: number
  pluginName: string
  /** Episode play-page URL (used for resolve + deep-link resume). */
  pageUrl: string
  /**
   * Source/detail URL used for chapters fetch (search hit `src`).
   * Optional for legacy rows; cold resume should prefer this over pageUrl.
   */
  sourceUrl?: string
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
