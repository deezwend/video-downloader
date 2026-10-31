import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import type { DownloadRequest, Lang, RemoveChoice, Settings } from '../shared/types'
import { loadNative, resourcesDir, wrap } from './native'
import { cookiesPath, hasCookies, logout, openLogin } from './login'

if (!app.requestSingleInstanceLock()) app.quit()

const native = loadNative()
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 700,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Video Downloader',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111113' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  const json = <T>(s: string): T => JSON.parse(s) as T

  ipcMain.handle('probe', (_e, url: string) => wrap(async () => json(await native.probe(url))))
  ipcMain.handle('preview', async (_e, url: string) => {
    const s = await native.preview(url).catch(() => null)
    return s ? json(s) : null
  })
  ipcMain.handle('enqueue', (_e, reqs: DownloadRequest[]) => native.enqueue(JSON.stringify(reqs)))
  ipcMain.handle('pause', (_e, id: string) => native.pause(id))
  ipcMain.handle('resume', (_e, id: string) => native.resume(id))
  ipcMain.handle('retry', (_e, id: string) => native.retry(id))
  ipcMain.handle('cancel', (_e, id: string) => native.cancel(id))
  ipcMain.handle('remove', (_e, id: string, deleteFile: boolean) => native.remove(id, deleteFile))
  ipcMain.handle('clearFinished', () => native.clearFinished())
  ipcMain.handle('listItems', () => json(native.listItems()))
  ipcMain.handle('getSettings', () => json(native.getSettings()))
  ipcMain.handle('setSettings', (_e, patch: Partial<Settings>) => json(native.setSettings(JSON.stringify(patch))))
  ipcMain.handle('binaryStatus', async () => json(await native.binaryStatus()))
  ipcMain.handle('updateYtdlp', () => wrap(() => native.updateYtdlp()))

  ipcMain.handle('confirmRemove', async (_e, lang: Lang): Promise<RemoveChoice> => {
    const en = lang === 'en'
    const opts = {
      type: 'question' as const,
      buttons: en ? ['Remove from list', 'Delete file', 'Cancel'] : ['Listeden kaldır', 'Dosyayı sil', 'Vazgeç'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      message: en ? 'Remove' : 'Kaldır'
    }
    const { response } = mainWindow
      ? await dialog.showMessageBox(mainWindow, opts)
      : await dialog.showMessageBox(opts)
    return (['list', 'file', 'cancel'] as const)[response]
  })

  ipcMain.handle('chooseFolder', async (_e, current?: string) => {
    const opts = { defaultPath: current, properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
    const res = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : res.filePaths[0]
  })
  ipcMain.handle('openPath', async (_e, path: string) => {
    await shell.openPath(path)
  })
  ipcMain.handle('showInFolder', (_e, path: string) => shell.showItemInFolder(path))

  ipcMain.handle('login', async () => {
    if (!mainWindow) return false
    const ok = await openLogin(mainWindow)
    native.setCookiesFile(ok ? cookiesPath() : null)
    return ok
  })
  ipcMain.handle('logout', async () => {
    await logout()
    native.setCookiesFile(null)
  })
  ipcMain.handle('isLoggedIn', () => hasCookies())
  ipcMain.handle('readClipboard', () => clipboard.readText())
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)

  native.init(app.getPath('userData'), resourcesDir(), app.getPath('downloads'), (event) => {
    mainWindow?.webContents.send('event', JSON.parse(event))
  })
  if (hasCookies()) native.setCookiesFile(cookiesPath())

  registerIpc()
  createWindow()
})

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app.on('before-quit', () => native.shutdown())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
