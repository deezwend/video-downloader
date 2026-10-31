import { contextBridge, ipcRenderer } from 'electron'
import type { Api, CoreEvent, UpdateState } from '../shared/types'

const invoke = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api: Api = {
  probe: invoke('probe'),
  preview: invoke('preview'),
  enqueue: invoke('enqueue'),
  pause: invoke('pause'),
  resume: invoke('resume'),
  retry: invoke('retry'),
  cancel: invoke('cancel'),
  remove: invoke('remove'),
  confirmRemove: invoke('confirmRemove'),
  clearFinished: invoke('clearFinished'),
  listItems: invoke('listItems'),
  getSettings: invoke('getSettings'),
  setSettings: invoke('setSettings'),
  binaryStatus: invoke('binaryStatus'),
  updateYtdlp: invoke('updateYtdlp'),
  chooseFolder: invoke('chooseFolder'),
  openPath: invoke('openPath'),
  showInFolder: invoke('showInFolder'),
  login: invoke('login'),
  logout: invoke('logout'),
  isLoggedIn: invoke('isLoggedIn'),
  readClipboard: invoke('readClipboard'),
  appVersion: invoke('appVersion'),
  updateState: invoke('updateState'),
  checkForUpdates: invoke('checkForUpdates'),
  installUpdate: invoke('installUpdate'),
  setThemeSource: invoke('setThemeSource'),
  onEvent(cb) {
    const listener = (_e: Electron.IpcRendererEvent, event: CoreEvent) => cb(event)
    ipcRenderer.on('event', listener)
    return () => ipcRenderer.removeListener('event', listener)
  },
  onUpdate(cb) {
    const listener = (_e: Electron.IpcRendererEvent, state: UpdateState) => cb(state)
    ipcRenderer.on('update', listener)
    return () => ipcRenderer.removeListener('update', listener)
  }
} as Api

contextBridge.exposeInMainWorld('api', api)
