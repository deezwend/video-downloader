import { useCallback, useEffect, useState } from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'
export type AccentName = 'blue' | 'green' | 'orange' | 'red' | 'gray'

export const ACCENTS: { name: AccentName; color: string }[] = [
  { name: 'blue', color: '#2563eb' },
  { name: 'green', color: '#16a34a' },
  { name: 'orange', color: '#ea580c' },
  { name: 'red', color: '#dc2626' },
  { name: 'gray', color: '#52525b' }
]

interface Theme {
  mode: ThemeMode
  accent: AccentName
}

const KEY = 'theme'
const DEFAULT: Theme = { mode: 'system', accent: 'blue' }

function load(): Theme {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    const mode: ThemeMode = ['system', 'light', 'dark'].includes(raw.mode) ? raw.mode : DEFAULT.mode
    const accent: AccentName = ACCENTS.some((a) => a.name === raw.accent) ? raw.accent : DEFAULT.accent
    return { mode, accent }
  } catch {
    return DEFAULT
  }
}

function apply({ mode, accent }: Theme): void {
  const dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  const root = document.documentElement
  root.dataset.theme = dark ? 'dark' : 'light'
  root.dataset.accent = accent
}

export function initTheme(): void {
  apply(load())
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(load)

  useEffect(() => {
    apply(theme)
    if (theme.mode !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply(theme)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  const update = useCallback((patch: Partial<Theme>) => {
    setTheme((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  return { ...theme, update }
}
