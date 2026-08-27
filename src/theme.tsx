import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

type Theme = 'dark' | 'light'

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: 'dark',
  toggle: () => {},
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

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}

/**
 * Cores para gráficos (Recharts precisa de hex concretos).
 * Séries em ordem fixa validada para daltonismo — nunca embaralhar.
 */
export function useVizColors() {
  const { theme } = useTheme()
  const dark = theme === 'dark'
  return {
    dark,
    series: dark
      ? ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
      : ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
    grid: dark ? '#2c2c2a' : '#e1e0d9',
    axis: dark ? '#383835' : '#c3c2b7',
    ink: dark ? '#ffffff' : '#0b0b0b',
    ink2: dark ? '#c3c2b7' : '#52514e',
    mute: '#898781',
    surface: dark ? '#1a1a19' : '#fcfcfb',
    positive: dark ? '#0ca30c' : '#006300',
    negative: dark ? '#e66767' : '#d03b3b',
    warning: dark ? '#fab219' : '#c98500',
  }
}
