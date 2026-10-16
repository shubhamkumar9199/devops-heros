// Stack of open drawers / modals / confirm dialogs.
// Only the top layer reacts to Esc and traps Tab; everything underneath
// (the app and lower layers) is made inert, and the page stops scrolling.

import { useEffect, useId, useRef, useSyncExternalStore } from 'react'

const stack = []
const listeners = new Set()

function emit() {
  const root = document.getElementById('root')
  if (root) root.inert = stack.length > 0
  document.documentElement.classList.toggle('has-layer', stack.length > 0)
  listeners.forEach((listener) => listener())
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(
    (el) => !el.closest('[inert]') && (el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement),
  )
}

/**
 * Register a layer. Returns { panelRef, index, isTop } where index drives the
 * z-index and isTop says whether this layer is interactive.
 */
export function useLayer(onClose, { focusPanel = false } = {}) {
  const id = useId()
  const panelRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const openerRef = useRef(null)

  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!openerRef.current) openerRef.current = document.activeElement
    stack.push(id)
    emit()

    // Forms start on their first field ([data-autofocus]); content panels such
    // as drawers start on the panel itself so Tab then walks through it.
    const panel = panelRef.current
    if (panel && !panel.contains(document.activeElement)) {
      const target = panel.querySelector('[data-autofocus]') || (focusPanel ? panel : focusables(panel)[0]) || panel
      target.focus({ preventScroll: true })
    }

    const onKeyDown = (event) => {
      if (stack[stack.length - 1] !== id) return
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        onCloseRef.current?.()
        return
      }
      if (event.key === 'Tab' && panelRef.current) {
        const nodes = focusables(panelRef.current)
        if (!nodes.length) {
          event.preventDefault()
          panelRef.current.focus()
          return
        }
        const first = nodes[0]
        const last = nodes[nodes.length - 1]
        const active = document.activeElement
        const inside = panelRef.current.contains(active)
        if (event.shiftKey && (active === first || !inside)) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && (active === last || !inside)) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const i = stack.indexOf(id)
      if (i >= 0) stack.splice(i, 1)
      emit()
      const opener = openerRef.current
      // Give focus back to whatever opened the layer once it is really gone
      // (StrictMode re-runs effects without removing the DOM).
      setTimeout(() => {
        if (panel && panel.isConnected) return
        if (opener && opener.isConnected && typeof opener.focus === 'function') {
          opener.focus({ preventScroll: true })
        }
      }, 0)
    }
  }, [id])

  const index = useSyncExternalStore(subscribe, () => stack.indexOf(id))
  const depth = useSyncExternalStore(subscribe, () => stack.length)
  return { panelRef, index: index < 0 ? depth : index, isTop: index === depth - 1 || index < 0 }
}
