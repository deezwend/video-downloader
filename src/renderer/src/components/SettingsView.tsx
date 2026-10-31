import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { BinaryInfo, BinaryStatus, Settings, UpdateState } from '../../../shared/types'
import { ACCENTS, useTheme } from '../theme'
import { setLangMode, useLangMode, useT } from '../i18n'

interface Props {
  settings: Settings
  bins: BinaryStatus | null
  loggedIn: boolean
  onChange(patch: Partial<Settings>): void
  onLogin(): void
  onLogout(): void
  onUpdate(): Promise<void>
}

const HEIGHTS = [2160, 1440, 1080, 720, 480, 360]

function Switch({ on, onChange }: { on: boolean; onChange(v: boolean): void }) {
  return <button className={`switch${on ? ' on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)} />
}

function Version({ info }: { info: BinaryInfo | undefined }) {
  const t = useT()
  if (!info?.path) return <span className="version missing">{t.missing}</span>
  return (
    <span className="version" title={info.path}>
      {info.version ?? '?'}
    </span>
  )
}

function AppUpdate() {
  const t = useT()
  const [version, setVersion] = useState('')
  const [state, setState] = useState<UpdateState>({ status: 'idle' })

  useEffect(() => {
    void window.api.appVersion().then(setVersion)
    void window.api.updateState().then(setState)
    return window.api.onUpdate(setState)
  }, [])

  const label = (() => {
    switch (state.status) {
      case 'latest':
        return t.upToDate
      case 'downloading':
        return t.updateDownloading(state.version, Math.round(state.percent))
      case 'downloaded':
        return t.updateReady(state.version)
      case 'error':
        return t.updateFailed
      case 'unsupported':
        return t.devBuild
      default:
        return null
    }
  })()
  const busy = state.status === 'checking' || state.status === 'downloading'

  return (
    <div className="setting">
      <span>{t.version}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className={`version${state.status === 'error' ? ' missing' : ''}`} title={state.status === 'error' ? state.message : undefined}>
          {version}
          {label && ` · ${label}`}
        </span>
        {state.status === 'downloaded' ? (
          <button className="btn small" onClick={() => void window.api.installUpdate()}>
            {t.restartToUpdate}
          </button>
        ) : (
          <button className="btn small" disabled={busy} onClick={() => void window.api.checkForUpdates()}>
            {busy ? <LoaderCircle size={14} className="spin" /> : null}
            {t.checkUpdates}
          </button>
        )}
      </div>
    </div>
  )
}

export default function SettingsView({ settings, bins, loggedIn, onChange, onLogin, onLogout, onUpdate }: Props) {
  const [rateLimit, setRateLimit] = useState(settings.rateLimit)
  const [updating, setUpdating] = useState(false)
  const theme = useTheme()
  const langMode = useLangMode()
  const t = useT()

  const chooseFolder = async () => {
    const dir = await window.api.chooseFolder(settings.downloadDir)
    if (dir) onChange({ downloadDir: dir })
  }

  const update = async () => {
    setUpdating(true)
    try {
      await onUpdate()
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="settings">
      <div className="settings-inner">
        <section className="section">
          <h3>{t.theme}</h3>
          <div className="setting">
            <span>{t.appearance}</span>
            <div className="segmented">
              {(
                [
                  ['system', t.system],
                  ['light', t.light],
                  ['dark', t.dark]
                ] as const
              ).map(([m, label]) => (
                <button key={m} className={theme.mode === m ? 'active' : ''} onClick={() => theme.update({ mode: m })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="setting">
            <span>{t.language}</span>
            <div className="segmented">
              {(
                [
                  ['system', t.system],
                  ['tr', 'Türkçe'],
                  ['en', 'English']
                ] as const
              ).map(([m, label]) => (
                <button key={m} className={langMode === m ? 'active' : ''} onClick={() => setLangMode(m)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="setting">
            <span>{t.accent}</span>
            <div className="swatches">
              {ACCENTS.map((a) => (
                <button
                  key={a.name}
                  className={`swatch${theme.accent === a.name ? ' active' : ''}`}
                  style={{ background: a.color }}
                  aria-label={a.name}
                  onClick={() => theme.update({ accent: a.name })}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="section">
          <h3>{t.downloads}</h3>
          <div className="setting">
            <span>{t.folder}</span>
            <div className="folder">
              <span className="path" title={settings.downloadDir}>
                &lrm;{settings.downloadDir}
              </span>
              <button className="btn small" onClick={chooseFolder}>
                {t.change}
              </button>
            </div>
          </div>
          <div className="setting">
            <span>{t.concurrency}</span>
            <div className="segmented">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className={settings.concurrency === n ? 'active' : ''}
                  onClick={() => onChange({ concurrency: n })}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="setting">
            <span>{t.rateLimit}</span>
            <input
              className="text-input"
              value={rateLimit}
              placeholder={t.unlimited}
              title={t.rateLimitHint}
              onChange={(e) => setRateLimit(e.target.value)}
              onBlur={() => {
                const value = rateLimit.trim().toUpperCase()
                const valid = value === '' || /^\d+(\.\d+)?[KMG]?$/.test(value)
                if (valid) onChange({ rateLimit: value })
                setRateLimit(valid ? value : settings.rateLimit)
              }}
            />
          </div>
          <div className="setting">
            <span>{t.playlistThrottle}</span>
            <Switch on={settings.playlistThrottle} onChange={(v) => onChange({ playlistThrottle: v })} />
          </div>
          <div className="setting">
            <span>{t.clipboardWatch}</span>
            <Switch on={settings.clipboardWatch} onChange={(v) => onChange({ clipboardWatch: v })} />
          </div>
        </section>

        <section className="section">
          <h3>{t.defaults}</h3>
          <div className="setting">
            <span>{t.kind}</span>
            <div className="segmented">
              <button
                className={settings.defaultKind === 'video' ? 'active' : ''}
                onClick={() => onChange({ defaultKind: 'video' })}
              >
                {t.video}
              </button>
              <button
                className={settings.defaultKind === 'audio' ? 'active' : ''}
                onClick={() => onChange({ defaultKind: 'audio' })}
              >
                {t.audio}
              </button>
            </div>
          </div>
          <div className="setting">
            <span>{t.quality}</span>
            <select
              className="select"
              value={settings.defaultHeight ?? ''}
              onChange={(e) => onChange({ defaultHeight: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">{t.best}</option>
              {HEIGHTS.map((h) => (
                <option key={h} value={h}>
                  {h}p
                </option>
              ))}
            </select>
          </div>
          <div className="setting">
            <span>{t.videoFormat}</span>
            <div className="segmented">
              {(['mp4', 'mkv'] as const).map((c) => (
                <button
                  key={c}
                  className={settings.videoContainer === c ? 'active' : ''}
                  onClick={() => onChange({ videoContainer: c })}
                >
                  {c.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="setting">
            <span>{t.audioFormat}</span>
            <div className="segmented">
              {(['m4a', 'mp3', 'opus'] as const).map((f) => (
                <button
                  key={f}
                  className={settings.audioFormat === f ? 'active' : ''}
                  onClick={() => onChange({ audioFormat: f })}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="section">
          <h3>{t.account}</h3>
          <div className="setting">
            <span>YouTube</span>
            {loggedIn ? (
              <button className="btn small danger" onClick={onLogout}>
                {t.logout}
              </button>
            ) : (
              <button className="btn small" onClick={onLogin}>
                {t.login}
              </button>
            )}
          </div>
        </section>

        <section className="section">
          <h3>{t.app}</h3>
          <AppUpdate />
        </section>

        <section className="section">
          <h3>{t.components}</h3>
          <div className="setting">
            <span>yt-dlp</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Version info={bins?.ytdlp} />
              <button className="btn small" disabled={updating} onClick={update}>
                {updating ? <LoaderCircle size={14} className="spin" /> : null}
                {t.update}
              </button>
            </div>
          </div>
          <div className="setting">
            <span>ffmpeg</span>
            <Version info={bins?.ffmpeg} />
          </div>
          <div className="setting">
            <span>Deno</span>
            <Version info={bins?.deno} />
          </div>
          <div className="setting">
            <span>{t.autoUpdate}</span>
            <Switch on={settings.autoUpdate} onChange={(v) => onChange({ autoUpdate: v })} />
          </div>
        </section>
      </div>
    </div>
  )
}
