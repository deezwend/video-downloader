import { contextBridge, ipcRenderer } from 'electron'
import type { Api, CoreEvent } from '../shared/types'

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
  onEvent(cb) {
    const listener = (_e: Electron.IpcRendererEvent, event: CoreEvent) => cb(event)
    ipcRenderer.on('event', listener)
    return () => ipcRenderer.removeListener('event', listener)
  }
} as Api

contextBridge.exposeInMainWorld('api', api)
