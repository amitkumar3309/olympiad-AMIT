import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import { applyStoredTheme } from './context/ThemeContext'
import App from './App.tsx'

/**
 * The theme goes on before React does.
 *
 * Dark lives on `:root` and light is the `.theme-light` override, so the default
 * needs no class — but a visitor who chose light would see a dark first paint if the
 * class waited for an effect. Module scope runs before the first paint, so this is
 * the only place the class can be applied without a flash. See `ThemeContext`.
 */
applyStoredTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
