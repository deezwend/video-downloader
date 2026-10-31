export function formatBytes(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i >= 2 ? 1 : 0)} ${units[i]}`
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec)) return ''
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const pad = (v: number) => v.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`
}

export function extractUrls(text: string): string[] {
  const urls = text.match(/https?:\/\/[^\s"'<>]+/g) ?? []
  return [...new Set(urls)]
}
