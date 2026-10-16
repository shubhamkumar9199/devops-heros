import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'

const MAX_TOASTS = 4
let nextId = 1

export function errorTitle(error) {
  if (!error || error.status === undefined) return 'Something went wrong'
  if (error.status === 0) return 'Cannot reach the server'
  if (error.status === 409) return 'Not allowed'
  if (error.status === 404) return 'Not found'
  if (error.status === 422) return 'Check the details'
  if (error.status >= 500) return 'Server problem'
  return 'Request failed'
}

/** Toast queue. toast.success(msg, title) / toast.error(errorOrMsg, title) / toast.info(msg, title) */
export function useToasts() {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
  }, [])

  const push = useCallback(
    (toast) => {
      const id = nextId++
      setToasts((list) => [...list.slice(-(MAX_TOASTS - 1)), { id, ...toast }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), toast.tone === 'error' ? 9000 : 5000),
      )
      return id
    },
    [dismiss],
  )

  useEffect(() => {
    const map = timers.current
    return () => map.forEach((timer) => clearTimeout(timer))
  }, [])

  const toast = useMemo(
    () => ({
      success: (message, title) => push({ tone: 'success', title, message }),
      info: (message, title) => push({ tone: 'info', title, message }),
      error: (error, title) => {
        if (error && typeof error === 'object') {
          push({
            tone: 'error',
            title: title || errorTitle(error),
            message: error.message || String(error),
            code: error.code && error.status ? `${error.status} · ${error.code}` : null,
          })
        } else {
          push({ tone: 'error', title: title || 'Something went wrong', message: String(error) })
        }
      },
    }),
    [push],
  )

  return { toasts, dismiss, toast }
}

const TONE_ICON = { success: 'checkCircle', error: 'alertCircle', info: 'info' }

export function ToastViewport({ toasts, dismiss }) {
  return createPortal(
    <div className="toasts" aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
          <span className="toast-icon">
            <Icon name={TONE_ICON[t.tone]} size={18} />
          </span>
          <div className="toast-body">
            {t.title ? <div className="toast-title">{t.title}</div> : null}
            <div className="toast-message">{t.message}</div>
            {t.code ? <div className="toast-code">{t.code}</div> : null}
          </div>
          <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}
