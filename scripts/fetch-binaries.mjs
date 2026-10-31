// Downloads yt-dlp (onedir), ffmpeg/ffprobe, Deno and bgutil-pot into resources/bin (Windows x64).
// Usage: node scripts/fetch-binaries.mjs [--force]
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') {
  console.error('Only Windows is supported for now.')
  process.exit(1)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(root, 'resources', 'bin')
const LICENSES = join(root, 'resources', 'licenses')
const PLUGINS = join(root, 'resources', 'plugins')
const force = process.argv.includes('--force')

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'video-downloader' }, redirect: 'follow' })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

function verify(buf, expected, name) {
  if (sha256(buf) !== expected.toLowerCase()) throw new Error(`checksum mismatch: ${name}`)
}

function unzip(zip, dest) {
  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`
  ])
}

async function findFile(dir, name) {
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.toLowerCase() === name) return join(entry.parentPath, entry.name)
  }
  return null
}

// Onedir build: starts ~1 s faster than the self-extracting yt-dlp.exe on every call.
async function ytdlp(tmp) {
  const base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'
  const file = 'yt-dlp_win.zip'
  const sums = (await get(`${base}/SHA2-256SUMS`)).toString()
  const expected = sums
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .find(([, name]) => name === file)?.[0]
  if (!expected) throw new Error('yt-dlp checksum not found')
  const zip = await get(`${base}/${file}`)
  verify(zip, expected, file)
  const zipPath = join(tmp, file)
  await writeFile(zipPath, zip)
  const dest = join(BIN, 'yt-dlp')
  await rm(dest, { recursive: true, force: true })
  unzip(zipPath, dest)
  await rm(join(BIN, 'yt-dlp.exe'), { force: true })
  await writeFile(join(LICENSES, 'yt-dlp.txt'), await get('https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/LICENSE'))
}

async function ffmpeg(tmp) {
  const base = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest'
  const file = 'ffmpeg-master-latest-win64-gpl.zip'
  const sums = (await get(`${base}/checksums.sha256`)).toString()
  const expected = sums
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .find(([, name]) => name?.replace(/^\*/, '') === file)?.[0]
  const zip = await get(`${base}/${file}`)
  if (expected) verify(zip, expected, file)
  const zipPath = join(tmp, file)
  await writeFile(zipPath, zip)
  const out = join(tmp, 'ffmpeg')
  unzip(zipPath, out)
  for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
    const src = await findFile(out, name)
    if (!src) throw new Error(`${name} not found in archive`)
    await copyFile(src, join(BIN, name))
  }
  const license = await findFile(out, 'license.txt')
  if (license) await copyFile(license, join(LICENSES, 'ffmpeg.txt'))
}

async function deno(tmp) {
  const base = 'https://github.com/denoland/deno/releases/latest/download'
  const file = 'deno-x86_64-pc-windows-msvc.zip'
  const zip = await get(`${base}/${file}`)
  const sum = (await get(`${base}/${file}.sha256sum`)).toString().match(/[a-f0-9]{64}/i)?.[0]
  if (sum) verify(zip, sum, file)
  const zipPath = join(tmp, file)
  await writeFile(zipPath, zip)
  const out = join(tmp, 'deno')
  unzip(zipPath, out)
  const src = await findFile(out, 'deno.exe')
  if (!src) throw new Error('deno.exe not found in archive')
  await copyFile(src, join(BIN, 'deno.exe'))
  await writeFile(join(LICENSES, 'deno.txt'), await get('https://raw.githubusercontent.com/denoland/deno/main/LICENSE.md'))
}

// PO token provider (bgutil-pot) + its yt-dlp plugin, so YouTube works without login.
async function pot(tmp) {
  const repo = 'jim60105/bgutil-ytdlp-pot-provider-rs'
  const release = JSON.parse((await get(`https://api.github.com/repos/${repo}/releases/latest`)).toString())
  const asset = (name) => {
    const a = release.assets.find((x) => x.name === name)
    if (!a) throw new Error(`${name} not found in ${release.tag_name}`)
    return a
  }
  const fetchVerified = async (name) => {
    const a = asset(name)
    const buf = await get(a.browser_download_url)
    if (a.digest?.startsWith('sha256:')) verify(buf, a.digest.slice(7), name)
    return buf
  }

  await writeFile(join(BIN, 'bgutil-pot.exe'), await fetchVerified('bgutil-pot-windows-x86_64.exe'))

  const zipPath = join(tmp, 'pot-plugin.zip')
  await writeFile(zipPath, await fetchVerified('bgutil-ytdlp-pot-provider-rs.zip'))
  const dest = join(PLUGINS, 'bgutil-ytdlp-pot-provider')
  await rm(dest, { recursive: true, force: true })
  unzip(zipPath, dest)
  await writeFile(join(LICENSES, 'bgutil-ytdlp-pot-provider.txt'), await get(`https://raw.githubusercontent.com/${repo}/master/LICENSE`).catch(() => Buffer.from(`https://github.com/${repo}\n`)))
}

const tasks = [
  ['yt-dlp', 'yt-dlp/yt-dlp.exe', ytdlp],
  ['ffmpeg', 'ffmpeg.exe', ffmpeg],
  ['deno', 'deno.exe', deno],
  ['bgutil-pot', 'bgutil-pot.exe', pot]
]

await mkdir(BIN, { recursive: true })
await mkdir(LICENSES, { recursive: true })
await mkdir(PLUGINS, { recursive: true })
const tmp = await mkdtemp(join(tmpdir(), 'vdl-bin-'))
try {
  for (const [name, exe, fn] of tasks) {
    if (!force && existsSync(join(BIN, exe))) {
      console.log(`${name}: exists`)
      continue
    }
    process.stdout.write(`${name}: downloading... `)
    await fn(tmp)
    console.log('ok')
  }
} finally {
  await rm(tmp, { recursive: true, force: true })
}
