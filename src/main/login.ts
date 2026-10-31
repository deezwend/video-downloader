import { app, BrowserWindow, session } from 'electron'
import { rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const PARTITION = 'persist:yt-login'
const LOGIN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F'
const DOMAIN = /(^|\.)(youtube|google)\.com$/
const AUTH_COOKIES = ['SAPISID', '__Secure-3PAPISID', 'LOGIN_INFO']

export function cookiesPath(): string {
  return join(app.getPath('userData'), 'cookies.txt')
}

export function hasCookies(): boolean {
  return existsSync(cookiesPath())
}

function loginSession(): Electron.Session {
  const ses = session.fromPartition(PARTITION)
  // Google rejects sign-in from user agents that mention Electron.
  ses.setUserAgent(app.userAgentFallback.replace(/\s(Electron|video-downloader)\/\S+/gi, ''))
  return ses
}

async function isLoggedIn(ses: Electron.Session): Promise<boolean> {
  const cookies = await ses.cookies.get({ domain: 'youtube.com' })
  return cookies.some((c) => AUTH_COOKIES.includes(c.name))
}

/** Writes the login partition's cookies as a Netscape cookies.txt. Returns false if not logged in. */
export async function exportCookies(): Promise<boolean> {
  const ses = loginSession()
  if (!(await isLoggedIn(ses))) {
    await rm(cookiesPath(), { force: true })
    return false
  }
  const lines = ['# Netscape HTTP Cookie File']
  for (const c of await ses.cookies.get({})) {
    if (!c.domain || !DOMAIN.test(c.domain.replace(/^\./, ''))) continue
    const domain = c.hostOnly ? c.domain.replace(/^\./, '') : c.domain.startsWith('.') ? c.domain : `.${c.domain}`
    lines.push(
      [
        domain,
        c.hostOnly ? 'FALSE' : 'TRUE',
        c.path ?? '/',
        c.secure ? 'TRUE' : 'FALSE',
        Math.floor(c.expirationDate ?? 0),
        c.name,
        c.value
      ].join('\t')
    )
  }
  await writeFile(cookiesPath(), lines.join('\n') + '\n', 'utf8')
  return true
}

export function openLogin(parent: BrowserWindow): Promise<boolean> {
  const ses = loginSession()
  const win = new BrowserWindow({
    parent,
    modal: true,
    width: 480,
    height: 700,
    autoHideMenuBar: true,
    title: 'YouTube',
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void win.loadURL(url)
    return { action: 'deny' }
  })
  // Close as soon as the login lands on YouTube; leaving it open lets YouTube rotate the cookies.
  win.webContents.on('did-navigate', async (_e, url) => {
    if (new URL(url).hostname.endsWith('youtube.com') && (await isLoggedIn(ses))) win.close()
  })

  return new Promise((resolve) => {
    win.on('closed', () => {
      exportCookies().then(resolve, () => resolve(false))
    })
    void win.loadURL(LOGIN_URL)
  })
}

export async function logout(): Promise<void> {
  await session.fromPartition(PARTITION).clearStorageData()
  await rm(cookiesPath(), { force: true })
}
