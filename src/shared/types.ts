export type MediaKind = 'video' | 'audio'

export type Lang = 'tr' | 'en'

export type Status =
  | 'pending'
  | 'queued'
  | 'downloading'
  | 'processing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'canceled'

export type ErrorKind =
  | 'bot_check'
  | 'auth_required'
  | 'unavailable'
  | 'geo_blocked'
  | 'network'
  | 'binary_missing'
  | 'unknown'

export interface ItemError {
  kind: ErrorKind
  message: string
}

export interface Progress {
  percent: number
  speed: number | null
  eta: number | null
  downloaded: number | null
  total: number | null
}

export interface DownloadRequest {
  url: string
  kind: MediaKind
  height: number | null
  container: string
  outputDir?: string | null
  title?: string | null
  thumbnail?: string | null
  duration?: number | null
  uploader?: string | null
  playlistTitle?: string | null
  throttle?: boolean
}

export interface DownloadItem {
  id: string
  url: string
  title: string | null
  thumbnail: string | null
  duration: number | null
  uploader: string | null
  playlistTitle: string | null
  kind: MediaKind
  height: number | null
  container: string
  outputDir: string
  throttle: boolean
  useCookies: boolean
  status: Status
  progress: Progress
  filePath: string | null
  error: ItemError | null
  createdAt: number
  finishedAt: number | null
}

export interface Settings {
  downloadDir: string
  concurrency: number
  defaultKind: MediaKind
  defaultHeight: number | null
  videoContainer: 'mp4' | 'mkv'
  audioFormat: 'm4a' | 'mp3' | 'opus'
  autoUpdate: boolean
  rateLimit: string
  clipboardWatch: boolean
  playlistThrottle: boolean
}

export interface QualityOption {
  height: number
  size: number | null
}

export interface PlaylistEntry {
  url: string
  id: string | null
  title: string | null
  duration: number | null
  thumbnail: string | null
}

export interface MediaInfo {
  isPlaylist: boolean
  url: string
  id: string | null
  title: string | null
  uploader: string | null
  thumbnail: string | null
  duration: number | null
  hasVideo: boolean
  qualities: QualityOption[]
  audioSize: number | null
  entries: PlaylistEntry[]
}

export interface BinaryInfo {
  path: string | null
  version: string | null
}

export interface BinaryStatus {
  ytdlp: BinaryInfo
  ffmpeg: BinaryInfo
  deno: BinaryInfo
}

export type CoreEvent =
  | { type: 'item'; item: DownloadItem }
  | { type: 'progress'; id: string; progress: Progress }
  | { type: 'removed'; id: string }
  | { type: 'binaries'; status: BinaryStatus }

export type Result<T> = { ok: true; value: T } | { ok: false; error: ItemError }

export type RemoveChoice = 'cancel' | 'list' | 'file'

export interface Api {
  probe(url: string): Promise<Result<MediaInfo>>
  /** Title/thumbnail only (no qualities), fast; null when the site is not supported. */
  preview(url: string): Promise<MediaInfo | null>
  enqueue(requests: DownloadRequest[]): Promise<string[]>
  pause(id: string): Promise<void>
  resume(id: string): Promise<void>
  retry(id: string): Promise<void>
  cancel(id: string): Promise<void>
  remove(id: string, deleteFile: boolean): Promise<void>
  confirmRemove(lang: Lang): Promise<RemoveChoice>
  clearFinished(): Promise<void>
  listItems(): Promise<DownloadItem[]>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  binaryStatus(): Promise<BinaryStatus>
  updateYtdlp(): Promise<Result<string>>
  chooseFolder(current?: string): Promise<string | null>
  openPath(path: string): Promise<void>
  showInFolder(path: string): Promise<void>
  login(): Promise<boolean>
  logout(): Promise<void>
  isLoggedIn(): Promise<boolean>
  readClipboard(): Promise<string>
  onEvent(cb: (event: CoreEvent) => void): () => void
}
