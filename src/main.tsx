import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './ErrorBoundary'
// DEV-only: exposes the profile look helpers on window so they can be exercised without a
// signed-in profile page. Tree-shaken out of production by the import.meta.env.DEV guard inside.
import './dev/lookProbe'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/**
     * The last resort, for a crash in the SHELL itself — the nav, the call dock, the backdrop.
     * Pages have their own boundary inside App (see <main>), which is where a broken page is
     * caught so it does not take the call and the music down with it. This one should almost
     * never be what you see.
     */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
