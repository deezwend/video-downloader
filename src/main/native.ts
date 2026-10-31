import { app } from 'electron'
import { join } from 'node:path'
import type { ItemError, Result } from '../shared/types'

export interface Native {
  init(dataDir: string, resourcesDir: string, downloadDir: string, onEvent: (event: string) => void): void
  probe(url: string): Promise<string>
  preview(url: string): Promise<string | null>
  enqueue(requests: string): string[]
  pause(id: string): void
  resume(id: string): void
  retry(id: string): void
  cancel(id: string): void
  remove(id: string, deleteFile: boolean): void
  clearFinished(): void
  listItems(): string
  getSettings(): string
  setSettings(patch: string): string
  binaryStatus(): Promise<string>
  updateYtdlp(): Promise<string>
  setCookiesFile(path: string | null): void
  shutdown(): void
}

export function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
}

export function loadNative(): Native {
  const path = app.isPackaged
    ? join(process.resourcesPath, 'native', 'vdl.node')
    : join(app.getAppPath(), 'build', 'native', 'vdl.node')
  const mod = { exports: {} as Native }
  process.dlopen(mod, path)
  return mod.exports
}

export function parseError(e: unknown): ItemError {
  const message = e instanceof Error ? e.message : String(e)
  try {
    const parsed = JSON.parse(message)
    if (parsed && typeof parsed.kind === 'string') return parsed as ItemError
  } catch {
    // not a structured core error
  }
  return { kind: 'unknown', message }
}

export async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (e) {
    return { ok: false, error: parseError(e) }
  }
}
