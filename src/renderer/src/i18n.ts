import { useSyncExternalStore } from 'react'
import type { ErrorKind, Lang, Status } from '../../shared/types'

export type LangMode = 'system' | Lang

const tr = {
  back: 'Geri',
  pasteLink: 'Bağlantı yapıştır',
  paste: 'Yapıştır',
  add: 'Ekle',
  addN: (n: number) => `Ekle (${n})`,
  settings: 'Ayarlar',
  noValidLink: 'Geçerli bağlantı yok',
  addedN: (n: number) => `${n} video listeye eklendi`,
  missingComponent: 'Eksik bileşen',
  downloadYtdlp: 'yt-dlp indir',
  login: 'Giriş yap',
  logout: 'Çıkış yap',
  close: 'Kapat',
  selectAll: 'Tümünü seç',
  tabAll: 'Tümü',
  tabActive: 'Aktif',
  tabDone: 'Tamamlanan',
  clearFinished: 'Bitenleri temizle',
  download: 'İndir',
  downloadN: (n: number) => `İndir (${n})`,
  noDownloads: 'İndirme yok',
  best: 'En iyi',
  pause: 'Duraklat',
  resume: 'Devam',
  retry: 'Tekrar dene',
  showInFolder: 'Klasörde göster',
  cancel: 'İptal',
  remove: 'Kaldır',
  nVideos: (n: number) => `${n} video`,
  video: 'Video',
  audio: 'Ses',
  quality: 'Kalite',
  format: 'Format',
  folder: 'Klasör',
  change: 'Değiştir',
  none: 'Hiçbiri',
  all: 'Tümü',
  missing: 'Yok',
  theme: 'Tema',
  appearance: 'Görünüm',
  system: 'Sistem',
  light: 'Açık',
  dark: 'Koyu',
  accent: 'Vurgu',
  language: 'Dil',
  downloads: 'İndirme',
  concurrency: 'Eşzamanlı indirme',
  rateLimit: 'Hız limiti',
  unlimited: 'Sınırsız',
  rateLimitHint: 'Örn. 5M, 500K',
  playlistThrottle: "Playlist'lerde bekleme",
  clipboardWatch: 'Panodaki bağlantıyı al',
  defaults: 'Varsayılan',
  kind: 'Tür',
  videoFormat: 'Video formatı',
  audioFormat: 'Ses formatı',
  account: 'Hesap',
  components: 'Bileşenler',
  update: 'Güncelle',
  autoUpdate: "yt-dlp'yi otomatik güncelle",
  app: 'Uygulama',
  version: 'Sürüm',
  checkUpdates: 'Güncellemeleri denetle',
  restartToUpdate: 'Yeniden başlat',
  upToDate: 'Güncel',
  updateDownloading: (v: string, p: number) => `${v} indiriliyor %${p}`,
  updateReady: (v: string) => `${v} yüklenmeye hazır`,
  updateFailed: 'Denetlenemedi',
  devBuild: 'Geliştirme sürümü',
  status: {
    pending: 'Bekliyor',
    queued: 'Sırada',
    downloading: 'İndiriliyor',
    processing: 'İşleniyor',
    paused: 'Duraklatıldı',
    completed: 'Tamamlandı',
    failed: 'Hata',
    canceled: 'İptal edildi'
  } as Record<Status, string>,
  error: {
    bot_check: 'YouTube doğrulama istedi',
    auth_required: 'Giriş gerekli',
    unavailable: 'Video kullanılamıyor',
    geo_blocked: 'Bölgenizde engelli',
    network: 'Bağlantı hatası',
    binary_missing: 'yt-dlp bulunamadı',
    unknown: 'Hata'
  } as Record<ErrorKind, string>
}

export type Strings = typeof tr

const en: Strings = {
  back: 'Back',
  pasteLink: 'Paste a link',
  paste: 'Paste',
  add: 'Add',
  addN: (n) => `Add (${n})`,
  settings: 'Settings',
  noValidLink: 'No valid link',
  addedN: (n) => `${n} ${n === 1 ? 'video' : 'videos'} added to the list`,
  missingComponent: 'Missing component',
  downloadYtdlp: 'Download yt-dlp',
  login: 'Sign in',
  logout: 'Sign out',
  close: 'Close',
  selectAll: 'Select all',
  tabAll: 'All',
  tabActive: 'Active',
  tabDone: 'Completed',
  clearFinished: 'Clear finished',
  download: 'Download',
  downloadN: (n) => `Download (${n})`,
  noDownloads: 'No downloads',
  best: 'Best',
  pause: 'Pause',
  resume: 'Resume',
  retry: 'Retry',
  showInFolder: 'Show in folder',
  cancel: 'Cancel',
  remove: 'Remove',
  nVideos: (n) => `${n} ${n === 1 ? 'video' : 'videos'}`,
  video: 'Video',
  audio: 'Audio',
  quality: 'Quality',
  format: 'Format',
  folder: 'Folder',
  change: 'Change',
  none: 'None',
  all: 'All',
  missing: 'Missing',
  theme: 'Theme',
  appearance: 'Appearance',
  system: 'System',
  light: 'Light',
  dark: 'Dark',
  accent: 'Accent',
  language: 'Language',
  downloads: 'Downloads',
  concurrency: 'Concurrent downloads',
  rateLimit: 'Speed limit',
  unlimited: 'Unlimited',
  rateLimitHint: 'e.g. 5M, 500K',
  playlistThrottle: 'Throttle playlists',
  clipboardWatch: 'Pick up links from clipboard',
  defaults: 'Defaults',
  kind: 'Type',
  videoFormat: 'Video format',
  audioFormat: 'Audio format',
  account: 'Account',
  components: 'Components',
  update: 'Update',
  autoUpdate: 'Update yt-dlp automatically',
  app: 'App',
  version: 'Version',
  checkUpdates: 'Check for updates',
  restartToUpdate: 'Restart',
  upToDate: 'Up to date',
  updateDownloading: (v, p) => `Downloading ${v} ${p}%`,
  updateReady: (v) => `${v} ready to install`,
  updateFailed: 'Check failed',
  devBuild: 'Development build',
  status: {
    pending: 'Pending',
    queued: 'Queued',
    downloading: 'Downloading',
    processing: 'Processing',
    paused: 'Paused',
    completed: 'Completed',
    failed: 'Failed',
    canceled: 'Canceled'
  },
  error: {
    bot_check: 'YouTube asked for verification',
    auth_required: 'Sign-in required',
    unavailable: 'Video unavailable',
    geo_blocked: 'Blocked in your region',
    network: 'Connection error',
    binary_missing: 'yt-dlp not found',
    unknown: 'Error'
  }
}

const STRINGS: Record<Lang, Strings> = { tr, en }
const KEY = 'lang'

function loadMode(): LangMode {
  try {
    const raw = localStorage.getItem(KEY)
    return raw === 'tr' || raw === 'en' ? raw : 'system'
  } catch {
    return 'system'
  }
}

const resolve = (mode: LangMode): Lang =>
  mode !== 'system' ? mode : navigator.language.toLowerCase().startsWith('tr') ? 'tr' : 'en'

let mode = loadMode()
const listeners = new Set<() => void>()

function apply(): void {
  document.documentElement.lang = resolve(mode)
}

export function initLang(): void {
  apply()
}

export function currentLang(): Lang {
  return resolve(mode)
}

export function setLangMode(next: LangMode): void {
  mode = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    /* ignore */
  }
  apply()
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useLangMode(): LangMode {
  return useSyncExternalStore(subscribe, () => mode)
}

export function useT(): Strings {
  return STRINGS[resolve(useLangMode())]
}
