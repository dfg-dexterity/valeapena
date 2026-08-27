import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { ThemeProvider } from './theme'
import { RatesProvider } from './lib/rates'
import { ScrollToTop } from './scroll'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <RatesProvider>
        <BrowserRouter>
          <ScrollToTop />
          <App />
        </BrowserRouter>
      </RatesProvider>
    </ThemeProvider>
  </StrictMode>,
)
