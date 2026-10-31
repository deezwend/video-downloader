import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle, X } from 'lucide-react'
import type { DownloadRequest, MediaInfo, MediaKind, Settings } from '../../../shared/types'
import { formatBytes, formatDuration } from '../format'
import { useT } from '../i18n'
import Thumb from './Thumb'

interface Props {
  info: MediaInfo
  /** Qualities are still being resolved. */
  loading: boolean
  settings: Settings
  onClose(): void
  onConfirm(requests: DownloadRequest[]): void
}

const VIDEO_CONTAINERS = ['mp4', 'mkv'] as const
const AUDIO_FORMATS = ['m4a', 'mp3', 'opus'] as const

function pickHeight(info: MediaInfo, preferred: number | null): number | null {
  if (preferred == null || info.qualities.length === 0) return preferred
  const fit = info.qualities.find((q) => q.height <= preferred)
  return fit ? fit.height : null
}

export default function FormatDialog({ info, loading, settings, onClose, onConfirm }: Props) {
  const t = useT()
  const [kind, setKind] = useState<MediaKind>(info.hasVideo ? settings.defaultKind : 'audio')
  const [height, setHeight] = useState<number | null>(() => pickHeight(info, settings.defaultHeight))
  const [heightTouched, setHeightTouched] = useState(false)
  const [container, setContainer] = useState<string>(settings.videoContainer)
  const [audioFormat, setAudioFormat] = useState<string>(settings.audioFormat)
  const [outputDir, setOutputDir] = useState(settings.downloadDir)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(info.entries.map((e) => e.url)))

  // Resolved info replaces the preview: fit the defaults to what is actually available.
  useEffect(() => {
    if (!info.hasVideo) setKind('audio')
    if (!heightTouched) setHeight(pickHeight(info, settings.defaultHeight))
  }, [info])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const best = info.qualities[0]
  const count = info.isPlaylist ? selected.size : 1
  const allSelected = selected.size === info.entries.length

  const subtitle = useMemo(() => {
    if (info.isPlaylist) return [info.uploader, t.nVideos(info.entries.length)].filter(Boolean).join(' · ')
    return [info.uploader, formatDuration(info.duration)].filter(Boolean).join(' · ')
  }, [info, t])

  const pickChip = (h: number | null) => {
    setHeight(h)
    setHeightTouched(true)
  }

  const toggle = (url: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })

  const confirm = () => {
    const base = {
      kind,
      height: kind === 'video' ? height : null,
      container: kind === 'video' ? container : audioFormat,
      outputDir
    }
    if (!info.isPlaylist) {
      onConfirm([
        {
          ...base,
          url: info.url,
          title: info.title,
          thumbnail: info.thumbnail,
          duration: info.duration,
          uploader: info.uploader
        }
      ])
      return
    }
    onConfirm(
      info.entries
        .filter((e) => selected.has(e.url))
        .map((e) => ({
          ...base,
          url: e.url,
          title: e.title,
          thumbnail: e.thumbnail,
          duration: e.duration,
          uploader: info.uploader,
          playlistTitle: info.title,
          throttle: settings.playlistThrottle
        }))
    )
  }

  const chooseFolder = async () => {
    const dir = await window.api.chooseFolder(outputDir)
    if (dir) setOutputDir(dir)
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true">
        <div className="dialog-head">
          <Thumb src={info.thumbnail ?? info.entries[0]?.thumbnail ?? null} />
          <div>
            <h2>{info.title ?? info.url}</h2>
            <div className="sub">{subtitle}</div>
          </div>
          <button className="icon-btn" title={t.close} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="dialog-body">
          {info.hasVideo && (
            <div className="segmented">
              <button className={kind === 'video' ? 'active' : ''} onClick={() => setKind('video')}>
                {t.video}
              </button>
              <button className={kind === 'audio' ? 'active' : ''} onClick={() => setKind('audio')}>
                {t.audio}
              </button>
            </div>
          )}

          {kind === 'video' ? (
            <>
              <div className="field">
                <span className="field-label">{t.quality}</span>
                {loading && info.qualities.length === 0 ? (
                  <div className="chips">
                    <LoaderCircle size={16} className="spin" />
                  </div>
                ) : (
                  <div className="chips">
                    <button className={`chip${height == null ? ' active' : ''}`} onClick={() => pickChip(null)}>
                      {t.best}
                      {best ? <small>{best.height}p</small> : null}
                    </button>
                    {info.qualities.map((q) => (
                      <button
                        key={q.height}
                        className={`chip${height === q.height ? ' active' : ''}`}
                        onClick={() => pickChip(q.height)}
                      >
                        {q.height}p{q.size ? <small>~{formatBytes(q.size)}</small> : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="field">
                <span className="field-label">{t.format}</span>
                <div className="segmented">
                  {VIDEO_CONTAINERS.map((c) => (
                    <button key={c} className={container === c ? 'active' : ''} onClick={() => setContainer(c)}>
                      {c.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="field">
              <span className="field-label">
                {t.format}{info.audioSize ? ` · ~${formatBytes(info.audioSize)}` : ''}
              </span>
              <div className="segmented">
                {AUDIO_FORMATS.map((f) => (
                  <button key={f} className={audioFormat === f ? 'active' : ''} onClick={() => setAudioFormat(f)}>
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="field">
            <span className="field-label">{t.folder}</span>
            <div className="folder">
              <span className="path" title={outputDir}>
                &lrm;{outputDir}
              </span>
              <button className="btn small" onClick={chooseFolder}>
                {t.change}
              </button>
            </div>
          </div>

          {info.isPlaylist && (
            <div className="field">
              <div className="entries-head">
                <span className="field-label">
                  {selected.size} / {info.entries.length}
                </span>
                <button
                  className="link-btn"
                  onClick={() => setSelected(allSelected ? new Set() : new Set(info.entries.map((e) => e.url)))}
                >
                  {allSelected ? t.none : t.all}
                </button>
              </div>
              <div className="entries">
                {info.entries.map((e, i) => (
                  <label key={e.url + i} className="entry">
                    <input type="checkbox" checked={selected.has(e.url)} onChange={() => toggle(e.url)} />
                    <span className="title">{e.title ?? e.url}</span>
                    <span className="time">{formatDuration(e.duration)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="dialog-foot">
          <button className="btn" onClick={onClose}>
            {t.cancel}
          </button>
          <button className="btn primary" disabled={count === 0} onClick={confirm}>
            {info.isPlaylist ? t.addN(count) : t.add}
          </button>
        </div>
      </div>
    </div>
  )
}
