import '@fontsource-variable/inter'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { AuthProvider } from './lib/auth.tsx'
import { supabase } from './lib/supabase.ts'
import './index.css'

// A magic link lands on the page with the session (or an error) in the URL
// hash, e.g. #access_token=... That hash collides with the hash router, so let
// Supabase consume it first, then reset the hash to the home route.
async function consumeAuthRedirect(): Promise<string | null> {
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const isAuthRedirect = hash.has('access_token') || hash.has('error_description')
  if (!isAuthRedirect) return null

  await supabase.auth.getSession() // waits for the client to read the hash
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`)
  return hash.get('error_description')
}

consumeAuthRedirect().then((authError) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AuthProvider>
        <App authError={authError} />
      </AuthProvider>
    </StrictMode>,
  )
})
