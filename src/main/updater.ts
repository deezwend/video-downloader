import { app, ipcMain, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/types'

const CHECK_INTERVAL = 6 * 60 * 60 * 1000

let state: UpdateState = { status: 'idle' }
let getWindow: () => BrowserWindow | null = () => null

function setState(next: UpdateState): void {
  state = next
  getWindow()?.webContents.send('update', state)
}

async function check(): Promise<void> {
  if (!app.isPackaged) {
    setState({ status: 'unsupported' })
    return
  }
  // Already found or fetching an update: a new check would only reset the progress.
  if (state.status === 'checking' || state.status === 'downloading' || state.status === 'downloaded') return
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

export function initUpdater(window: () => BrowserWindow | null): void {
  getWindow = window
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => setState({ status: 'checking' }))
  autoUpdater.on('update-not-available', () => setState({ status: 'latest' }))
  autoUpdater.on('update-available', (info) => setState({ status: 'downloading', version: info.version, percent: 0 }))
  autoUpdater.on('download-progress', (p) =>
    setState({ status: 'downloading', version: state.status === 'downloading' ? state.version : '', percent: p.percent })
  )
  autoUpdater.on('update-downloaded', (info) => setState({ status: 'downloaded', version: info.version }))
  autoUpdater.on('error', (e) => setState({ status: 'error', message: e.message }))

  ipcMain.handle('appVersion', () => app.getVersion())
  ipcMain.handle('updateState', () => state)
  ipcMain.handle('checkForUpdates', () => check())
  ipcMain.handle('installUpdate', () => {
    if (state.status === 'downloaded') autoUpdater.quitAndInstall()
  })

  if (app.isPackaged) {
    void check()
    setInterval(() => void check(), CHECK_INTERVAL)
  }
}
