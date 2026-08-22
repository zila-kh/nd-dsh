import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './component.css'

// Apply a best-effort system theme before the preload-backed theme service
// returns the user's persisted preference.
const initialTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
document.documentElement.dataset.theme = initialTheme
document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', initialTheme)

function RuntimeUnavailable() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 32 }}>
      <section style={{ maxWidth: 620 }}>
        <small>ND-DSH · DESKTOP RUNTIME REQUIRED</small>
        <h1>ND runtime unavailable</h1>
        <p>
          This product shell requires the trusted Electron preload and organization runtime.
          ND-DSH no longer substitutes demo companies, fake workspaces, or mock agent sessions.
        </p>
        <p>Launch the ND-DSH desktop application or run the desktop development target.</p>
      </section>
    </main>
  )
}

function boot(): void {
  const root = ReactDOM.createRoot(document.getElementById('root')!)
  if (typeof window.ndDsh === 'undefined' || typeof window.ndDshOrganization === 'undefined') {
    root.render(<RuntimeUnavailable />)
    return
  }

  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

boot()
