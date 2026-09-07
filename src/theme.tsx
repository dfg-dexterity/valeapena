import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

type Theme = 'dark' | 'light'

const ThemeContext = createContext<{ theme: Theme; toggle: () => void; set: (t: Theme) => void }>({
  theme: 'dark',
  toggle: () => {},
  set: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem('valeapena-theme') === 'light' ? 'light' : 'dark'
    } catch {
      return 'dark'
    }
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('valeapena-theme', theme)
    } catch {
      /* armazenamento indisponível */
    }
  }, [theme])

  const toggle = useCallback(() => setTheme(t => (t === 'dark' ? 'light' : 'dark')), [])
  const set = useCallback((t: Theme) => setTheme(t), [])

  return <ThemeContext.Provider value={{ theme, toggle, set }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}

/**
 * Cores para gráficos (Recharts precisa de hex concretos).
 * Paleta Dexterity — séries em ordem fixa (slot 0 = principal/cerceta,
 * 1 = alternativa/laranja, 2 = terceira), distinção por matiz+luminância
 * para daltonismo — nunca embaralhar.
 */
export function useVizColors() {
  const { theme } = useTheme()
  const dark = theme === 'dark'
  return {
    dark,
    series: dark
      ? ['#22c1ba', '#ffa436', '#c084c2', '#8fb08f', '#e87ba4', '#3987e5', '#c98500', '#e66767']
      : ['#00807b', '#c56f00', '#98569a', '#597c59', '#c95c86', '#2a78d6', '#9c6a00', '#d03b3b'],
    grid: dark ? '#312f2a' : '#e4decb',
    axis: dark ? '#403d36' : '#c7c0aa',
    ink: dark ? '#f7f3e7' : '#33312c',
    ink2: dark ? '#c9c4b2' : '#5d5a4f',
    mute: dark ? '#948f7d' : '#6d6959',
    surface: dark ? '#211f1c' : '#fffdf8',
    positive: dark ? '#0ca30c' : '#006300',
    negative: dark ? '#e66767' : '#d03b3b',
    warning: dark ? '#fab219' : '#c98500',
  }
}
