import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

type Tone = 'good' | 'error' | 'plain'
type Toast = { id: number; message: string; tone: Tone }

type Toaster = {
  good: (message: string) => void
  error: (message: string) => void
  say: (message: string) => void
}

const ToastContext = createContext<Toaster | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const show = useCallback((message: string, tone: Tone) => {
    const id = nextId.current++
    // An error stays up longer: it usually needs reading twice.
    setToasts((current) => [...current.slice(-2), { id, message, tone }])
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 3500)
  }, [])

  const toaster = useMemo<Toaster>(
    () => ({
      good: (message) => show(message, 'good'),
      error: (message) => show(message, 'error'),
      say: (message) => show(message, 'plain'),
    }),
    [show],
  )

  return (
    <ToastContext.Provider value={toaster}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast ${toast.tone}`}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// oxlint-disable-next-line react/only-export-components
export function useToast() {
  const toaster = useContext(ToastContext)
  if (!toaster) throw new Error('useToast must be used inside ToastProvider')
  return toaster
}
