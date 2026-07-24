import type {
  DanmakuAnime,
  DanmakuComment,
  DanmakuEpisode,
  DanmakuSettings,
  PlayerSettings,
} from '@aniku/shared'
import type {
  DanmakuPoolId,
  DanmakuSourceChip,
} from '../lib/danmaku-pools'

export interface DanmakuPanelState {
  status: string
  commentsCount: number
  /** currently drawn after source toggles */
  visibleCount?: number
  keyword: string
  onKeywordChange: (v: string) => void
  onSearch: () => void
  searchBusy?: boolean
  animes: DanmakuAnime[]
  episodes: DanmakuEpisode[]
  animeId: number | ''
  episodeId: number | ''
  onAnimeChange: (id: number) => void
  onEpisodeChange: (id: number) => void
  bvInput: string
  onBvInputChange: (v: string) => void
  bvPage: number
  onBvPageChange: (p: number) => void
  onLoadBilibili: () => void
  bilibiliBusy?: boolean
  onLoadXmlFile: (file: File) => void
  sources?: DanmakuSourceChip[]
  onToggleSource?: (id: DanmakuPoolId) => void
}

export interface VideoPlayerProps {
  src: string
  initialTime?: number
  comments: DanmakuComment[]
  danmaku: DanmakuSettings
  player: PlayerSettings
  onPlayerChange?: (partial: Partial<PlayerSettings>) => void
  onProgress?: (position: number, duration: number) => void
  onToggleDanmaku?: () => void
  onDanmakuChange?: (partial: Partial<DanmakuSettings>) => void
  onEnded?: () => void
  onPrev?: () => void
  onNext?: () => void
  embedded?: boolean
  hideHints?: boolean
  danmakuPanel?: DanmakuPanelState
  /**
   * Cookie / signed media expired (proxy 403 auth_expired or media error on cookie URL).
   * Parent should re-resolve and pass a new src; return a Promise to await.
   */
  onMediaAuthExpired?: (position: number) => void | Promise<void>
  /**
   * Unrecoverable media failure (e.g. direct CDN CORS / hotlink block).
   * Parent may switch to proxyUrl and remount. Called at most once per src.
   */
  onMediaLoadFailed?: (info: {
    position: number
    reason: string
  }) => void
}
