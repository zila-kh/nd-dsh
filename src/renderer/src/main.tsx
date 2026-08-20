import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installWebBridge } from './lib/web-bridge'
import './styles.css'
import './component.css'

// Apply a best-effort theme before the first paint; the persisted preference
// replaces it as soon as the main process answers.
const initialTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
document.documentElement.dataset.theme = initialTheme
document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', initialTheme)

// The same bundle is served to the built-in browser view and any plain web
// tab, where Electron's preload bridge does not exist. Install a web-mode
// stub so the full shell still renders; desktop-only actions surface a toast.
if (typeof window.ndDsh === 'undefined' || window.ndDsh === null) {
  installWebBridge()
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
