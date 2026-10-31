import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ClipboardPaste, Download, Link2, ListX, LoaderCircle, Plus, Settings as SettingsIcon } from 'lucide-react'
import type {
  BinaryStatus,
  DownloadItem,
  DownloadRequest,
  ItemError,
  MediaInfo,
  Settings
} from '../../shared/types'
import { extractUrls } from './format'
import { currentLang, useT } from './i18n'
import DownloadRow, { isStartable } from './components/DownloadRow'
import FormatDialog from './components/FormatDialog'
import SettingsView from './components/SettingsView'

type Tab = 'all' | 'active' | 'done'
const api = window.api

const isActive = (i: DownloadItem) => !['completed', 'canceled', 'failed'].includes(i.status)

function defaultRequest(url: string, s: Settings): DownloadRequest {
  return {
    url,
    kind: s.defaultKind,
    height: s.defaultKind === 'video' ? s.defaultHeight : null,
    container: s.defaultKind === 'video' ? s.videoContainer : s.audioFormat
  }
}

export default function App() {
  const [items, setItems] = useState<Record<string, DownloadItem>>({})
  const [settings, setSettings] = useState<Settings | null>(null)
  const [bins, setBins] = useState<BinaryStatus | null>(null)
  const [loggedIn, setLoggedIn] = useState(false)
  const [view, setView] = useState<'list' | 'settings'>('list')
  const [tab, setTab] = useState<Tab>('all')
  const [url, setUrl] = useState('')
  const [probing, setProbing] = useState(false)
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [probeError, setProbeError] = useState<{ url: string; error: ItemError } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [updating, setUpdating] = useState(false)
  const probeToken = useRef(0)
  const lastClip = useRef('')
  const t = useT()

  useEffect(() => {
    void api.listItems().then((list) => setItems(Object.fromEntries(list.map((i) => [i.id, i]))))
    void api.getSettings().then(setSettings)
    void api.binaryStatus().then(setBins)
    void api.isLoggedIn().then(setLoggedIn)
    return api.onEvent((e) => {
      switch (e.type) {
        case 'item':
          setItems((prev) => ({ ...prev, [e.item.id]: e.item }))
          break
        case 'progress':
          setItems((prev) => (prev[e.id] ? { ...prev, [e.id]: { ...prev[e.id], progress: e.progress } } : prev))
          break
        case 'removed':
          setItems((prev) => {
            const next = { ...prev }
            delete next[e.id]
            return next
          })
          setSelected((s) => (s === e.id ? null : s))
          break
        case 'binaries':
          setBins(e.status)
          break
      }
    })
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const probe = useCallback(async (target: string) => {
    const token = ++probeToken.current
    setProbing(true)
    setProbeError(null)
    let resolved = false
    // The preview opens the dialog right away; qualities fill in once yt-dlp is done.
    void api.preview(target).then((preview) => {
      if (preview && !resolved && token === probeToken.current) setInfo(preview)
    })
    const res = await api.probe(target)
    resolved = true
    if (token !== probeToken.current) return
    setProbing(false)
    if (res.ok) {
      setInfo(res.value)
    } else {
      setInfo(null)
      setProbeError({ url: target, error: res.error })
    }
  }, [])

  const submit = useCallback(
    async (text: string) => {
      const urls = extractUrls(text)
      if (urls.length === 0) {
        setToast(t.noValidLink)
        return
      }
      if (urls.length > 1 && settings) {
        await api.enqueue(urls.map((u) => defaultRequest(u, settings)))
        setToast(t.addedN(urls.length))
        setUrl('')
        setView('list')
        return
      }
      setUrl(urls[0])
      setView('list')
      void probe(urls[0])
    },
    [settings, probe, t]
  )

  const login = useCallback(async () => {
    const ok = await api.login()
    setLoggedIn(ok)
    if (!ok) return
    Object.values(items)
      .filter((i) => i.status === 'failed' && i.error?.kind === 'auth_required')
      .forEach((i) => void api.retry(i.id))
    if (probeError?.error.kind === 'auth_required') void probe(probeError.url)
  }, [items, probeError, probe])

  const logout = useCallback(async () => {
    await api.logout()
    setLoggedIn(false)
  }, [])

  const updateYtdlp = useCallback(async () => {
    setUpdating(true)
    const res = await api.updateYtdlp()
    setUpdating(false)
    setBins(await api.binaryStatus())
    setToast(res.ok ? `yt-dlp ${res.value}` : res.error.message)
  }, [])

  const removeItem = useCallback(async (item: DownloadItem) => {
    if (item.status === 'completed' && item.filePath) {
      const choice = await api.confirmRemove(currentLang())
      if (choice !== 'cancel') void api.remove(item.id, choice === 'file')
    } else {
      void api.remove(item.id, false)
    }
  }, [])

  const changeSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings(await api.setSettings(patch))
  }, [])

  const cancelProbe = useCallback(() => {
    probeToken.current++
    setProbing(false)
    setInfo(null)
  }, [])

  const confirmDownload = useCallback(async (requests: DownloadRequest[]) => {
    cancelProbe()
    setUrl('')
    await api.enqueue(requests)
  }, [cancelProbe])

  // Keyboard: Ctrl+V fills the field from clipboard, Delete removes selection.
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (info || target.tagName === 'INPUT' || target.tagName === 'SELECT') return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        const urls = extractUrls(await api.readClipboard())
        if (urls.length > 0) setUrl(urls.join(' '))
      } else if (e.key === 'Delete' && selected && items[selected]) {
        void removeItem(items[selected])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [info, selected, items, removeItem])

  // Clipboard watch on window focus.
  useEffect(() => {
    if (!settings?.clipboardWatch) return
    const onFocus = async () => {
      if (info || probing) return
      const found = extractUrls(await api.readClipboard())[0]
      if (!found || found === lastClip.current) return
      lastClip.current = found
      if (Object.values(items).some((i) => i.url === found)) return
      setUrl(found)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [settings?.clipboardWatch, info, probing, items])

  const check = useCallback((id: string, on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const startChecked = useCallback(() => {
    for (const id of checked) {
      const item = items[id]
      if (!item || !isStartable(item)) continue
      if (item.status === 'pending' || item.status === 'paused') void api.resume(id)
      else void api.retry(id)
    }
    setChecked(new Set())
  }, [checked, items])

  const sorted = useMemo(() => Object.values(items).sort((a, b) => b.createdAt - a.createdAt), [items])
  const counts = useMemo(
    () => ({
      all: sorted.length,
      active: sorted.filter(isActive).length,
      done: sorted.filter((i) => i.status === 'completed').length
    }),
    [sorted]
  )
  const visible = useMemo(() => {
    if (tab === 'active') return sorted.filter(isActive)
    if (tab === 'done') return sorted.filter((i) => i.status === 'completed')
    return sorted
  }, [sorted, tab])

  const startable = useMemo(() => visible.filter(isStartable), [visible])
  const checkedCount = useMemo(
    () => sorted.filter((i) => checked.has(i.id) && isStartable(i)).length,
    [sorted, checked]
  )
  const allChecked = startable.length > 0 && startable.every((i) => checked.has(i.id))

  const missing = bins ? (['ytdlp', 'ffmpeg'] as const).filter((k) => !bins[k].path) : []

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    if (text) void submit(text)
  }

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      <header className="header">
        {view === 'settings' && (
          <button className="icon-btn" title={t.back} onClick={() => setView('list')}>
            <ArrowLeft size={18} />
          </button>
        )}
        <form
          className="url-field"
          onSubmit={(e) => {
            e.preventDefault()
            void submit(url)
          }}
        >
          {probing ? <LoaderCircle size={16} className="icon spin" /> : <Link2 size={16} className="icon" />}
          <input
            value={url}
            placeholder={t.pasteLink}
            spellCheck={false}
            onChange={(e) => setUrl(e.target.value)}
            onPaste={(e) => {
              const urls = extractUrls(e.clipboardData.getData('text'))
              if (urls.length > 0) {
                e.preventDefault()
                setUrl(urls.join(' '))
              }
            }}
          />
          {!url && (
            <button
              type="button"
              className="icon-btn"
              title={t.paste}
              onClick={async () => setUrl(extractUrls(await api.readClipboard()).join(' '))}
            >
              <ClipboardPaste size={16} />
            </button>
          )}
        </form>
        <button className="btn primary" disabled={!url.trim() || probing} onClick={() => submit(url)}>
          <Plus size={16} />
          {t.add}
        </button>
        <button
          className={`icon-btn${view === 'settings' ? ' active' : ''}`}
          title={t.settings}
          onClick={() => setView(view === 'settings' ? 'list' : 'settings')}
        >
          <SettingsIcon size={18} />
        </button>
      </header>

      {missing.length > 0 && (
        <div className="banner error">
          <span className="grow">{t.missingComponent}: {missing.map((k) => (k === 'ytdlp' ? 'yt-dlp' : k)).join(', ')}</span>
          {missing.includes('ytdlp') && (
            <button className="btn small" disabled={updating} onClick={updateYtdlp}>
              {updating ? <LoaderCircle size={14} className="spin" /> : null}
              {t.downloadYtdlp}
            </button>
          )}
        </div>
      )}

      {probeError && (
        <div className="banner error">
          <span className="grow" title={probeError.error.message}>
            {probeError.error.kind === 'unknown' ? probeError.error.message : t.error[probeError.error.kind]}
          </span>
          {probeError.error.kind === 'auth_required' && (
            <button className="btn small" onClick={login}>
              {t.login}
            </button>
          )}
          <button className="btn small" onClick={() => setProbeError(null)}>
            {t.close}
          </button>
        </div>
      )}

      {view === 'settings' && settings ? (
        <SettingsView
          settings={settings}
          bins={bins}
          loggedIn={loggedIn}
          onChange={changeSettings}
          onLogin={login}
          onLogout={logout}
          onUpdate={updateYtdlp}
        />
      ) : (
        <>
          <div className="toolbar">
            <input
              type="checkbox"
              className="check"
              title={t.selectAll}
              checked={allChecked}
              disabled={startable.length === 0}
              onChange={(e) => startable.forEach((i) => check(i.id, e.target.checked))}
            />
            <div className="tabs">
              {(
                [
                  ['all', t.tabAll],
                  ['active', t.tabActive],
                  ['done', t.tabDone]
                ] as const
              ).map(([key, label]) => (
                <button key={key} className={`tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>
                  {label}
                  <span className="count">{counts[key]}</span>
                </button>
              ))}
            </div>
            <button
              className="icon-btn"
              title={t.clearFinished}
              disabled={!sorted.some((i) => i.status === 'completed' || i.status === 'canceled')}
              onClick={() => api.clearFinished()}
            >
              <ListX size={16} />
            </button>
            <button className="btn primary small" disabled={checkedCount === 0} onClick={startChecked}>
              <Download size={14} />
              {checkedCount > 0 ? t.downloadN(checkedCount) : t.download}
            </button>
          </div>
          <div className="list" onClick={(e) => e.target === e.currentTarget && setSelected(null)}>
            {visible.length === 0 ? (
              <div className="empty">
                <Download size={28} />
                <span>{t.noDownloads}</span>
              </div>
            ) : (
              visible.map((item) => (
                <DownloadRow
                  key={item.id}
                  item={item}
                  selected={selected === item.id}
                  checked={checked.has(item.id)}
                  onSelect={setSelected}
                  onCheck={check}
                  onRemove={removeItem}
                  onLogin={login}
                />
              ))
            )}
          </div>
        </>
      )}

      {info && settings && (
        <FormatDialog
          key={info.isPlaylist ? 'playlist' : 'single'}
          info={info}
          loading={probing}
          settings={settings}
          onClose={cancelProbe}
          onConfirm={confirmDownload}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
      {dragging && <div className="drop-hint" />}
    </div>
  )
}
