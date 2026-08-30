import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './lib/i18n'
import App from './App.jsx'

// NFR-UX-06: iOS Safari does not fire `:active` on tap unless the document
// carries at least one `touchstart` listener. A single passive no-op is the
// documented workaround (and the M8 phone mockup's own line 2099) — without
// it the phone shell's press feedback silently never happens on iPhones.
document.addEventListener('touchstart', () => {}, { passive: true })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
