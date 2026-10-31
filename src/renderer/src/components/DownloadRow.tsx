import { memo } from 'react'
import { FolderOpen, LogIn, Pause, Play, RotateCcw, Trash2, X } from 'lucide-react'
import type { DownloadItem } from '../../../shared/types'
import { formatBytes, formatDuration } from '../format'
import { useT, type Strings } from '../i18n'
import Thumb from './Thumb'

interface Props {
  item: DownloadItem
  selected: boolean
  checked: boolean
  onSelect(id: string): void
  onCheck(id: string, checked: boolean): void
  onRemove(item: DownloadItem): void
  onLogin(): void
}

function qualityLabel(item: DownloadItem, t: Strings): string {
  if (item.kind === 'audio') return item.container
  return `${item.height ? `${item.height}p` : t.best} ${item.container}`
}

export const isStartable = (item: DownloadItem) =>
  ['pending', 'paused', 'failed', 'canceled'].includes(item.status)

function DownloadRow({ item, selected, checked, onSelect, onCheck, onRemove, onLogin }: Props) {
  const { status, progress } = item
  const api = window.api
  const t = useT()
  const running = status === 'downloading' || status === 'processing'
  const showBar = running || status === 'paused' || status === 'queued'

  const meta = () => {
    if (status === 'failed' && item.error) {
      const label = t.error[item.error.kind]
      return (
        <>
          <span className="error-text" title={item.error.message}>
            {item.error.kind === 'unknown' ? item.error.message : label}
          </span>
          {item.error.kind === 'auth_required' && (
            <button className="link-btn" onClick={onLogin}>
              {t.login}
            </button>
          )}
        </>
      )
    }
    if (status === 'downloading') {
      return (
        <>
          <span>{progress.percent.toFixed(1)}%</span>
          {progress.total ? (
            <span>
              {formatBytes(progress.downloaded)} / {formatBytes(progress.total)}
            </span>
          ) : null}
          {progress.speed ? <span>{formatBytes(progress.speed)}/s</span> : null}
          {progress.eta != null ? <span>{formatDuration(progress.eta)}</span> : null}
        </>
      )
    }
    if (status === 'completed') {
      return (
        <>
          <span className="ok">{t.status.completed}</span>
          {progress.total ? <span>{formatBytes(progress.total)}</span> : null}
        </>
      )
    }
    return (
      <>
        <span>{t.status[status]}</span>
        {status === 'paused' && progress.percent > 0 ? <span>{progress.percent.toFixed(1)}%</span> : null}
      </>
    )
  }

  return (
    <div
      className={`row${selected ? ' selected' : ''}`}
      onClick={() => onSelect(item.id)}
      onDoubleClick={() => item.filePath && api.openPath(item.filePath)}
    >
      <input
        type="checkbox"
        className="check"
        checked={checked}
        disabled={!isStartable(item)}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onCheck(item.id, e.target.checked)}
      />
      <Thumb src={item.thumbnail} kind={item.kind} duration={item.duration} />
      <div className="row-main">
        <div className="row-title" title={item.title ?? item.url}>
          {item.title ?? item.url}
        </div>
        <div className="row-meta">
          <span className="badge">{qualityLabel(item, t)}</span>
          {meta()}
        </div>
        {showBar && (
          <div
            className={`bar${status === 'paused' || status === 'queued' ? ' paused' : ''}${
              status === 'processing' ? ' indeterminate' : ''
            }`}
          >
            <div style={{ width: `${progress.percent}%` }} />
          </div>
        )}
      </div>
      <div className="row-actions" onClick={(e) => e.stopPropagation()}>
        {(running || status === 'queued') && (
          <button className="icon-btn" title={t.pause} onClick={() => api.pause(item.id)}>
            <Pause size={16} />
          </button>
        )}
        {(status === 'paused' || status === 'pending') && (
          <button className="icon-btn" title={status === 'pending' ? t.download : t.resume} onClick={() => api.resume(item.id)}>
            <Play size={16} />
          </button>
        )}
        {(status === 'failed' || status === 'canceled') && (
          <button className="icon-btn" title={t.retry} onClick={() => api.retry(item.id)}>
            <RotateCcw size={16} />
          </button>
        )}
        {status === 'failed' && item.error?.kind === 'auth_required' && (
          <button className="icon-btn" title={t.login} onClick={onLogin}>
            <LogIn size={16} />
          </button>
        )}
        {status === 'completed' && (
          <button
            className="icon-btn"
            title={t.showInFolder}
            onClick={() => (item.filePath ? api.showInFolder(item.filePath) : api.openPath(item.outputDir))}
          >
            <FolderOpen size={16} />
          </button>
        )}
        {running || status === 'queued' || status === 'paused' ? (
          <button className="icon-btn" title={t.cancel} onClick={() => api.cancel(item.id)}>
            <X size={16} />
          </button>
        ) : (
          <button className="icon-btn" title={t.remove} onClick={() => onRemove(item)}>
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

export default memo(DownloadRow)
