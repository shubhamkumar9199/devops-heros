import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

/**
 * Load data and keep it fresh.
 *   const { data, error, loading, reload } = useResource(() => api.books(q), [q, version], { interval: 15000 })
 * Previous data is kept while a reload runs (no skeleton flash), so views
 * only show a skeleton when there is nothing to show yet.
 */
export function useResource(loader, deps, { interval = 0, enabled = true } = {}) {
  const [state, setState] = useState({ data: undefined, error: null, loading: enabled, updatedAt: 0 })
  const loaderRef = useRef(loader)
  const requestRef = useRef(0)

  useEffect(() => {
    loaderRef.current = loader
  })

  const load = useCallback(async () => {
    const id = ++requestRef.current
    setState((s) => (s.loading ? s : { ...s, loading: true }))
    try {
      const data = await loaderRef.current()
      if (id === requestRef.current) setState({ data, error: null, loading: false, updatedAt: Date.now() })
    } catch (error) {
      if (id === requestRef.current) setState((s) => ({ ...s, error, loading: false }))
    }
  }, [])

  useEffect(() => {
    if (enabled) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, load, ...deps])

  useEffect(() => {
    if (!interval || !enabled) return undefined
    const timer = setInterval(() => {
      if (!document.hidden) load()
    }, interval)
    return () => clearInterval(timer)
  }, [interval, enabled, load])

  return { ...state, reload: load }
}

export function useDebounced(value, delay = 250) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/** Re-render every `ms` so relative times ("3 min ago") stay current. */
export function useTicker(ms = 30000) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), ms)
    return () => clearInterval(timer)
  }, [ms])
  return tick
}

// --- hash router -------------------------------------------------------------

export const VIEWS = ['dashboard', 'catalogue', 'members', 'loans', 'holds']

const routeListeners = new Set()
const emitRoute = () => routeListeners.forEach((listener) => listener())
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', emitRoute)
  window.addEventListener('popstate', emitRoute)
}

function subscribeRoute(listener) {
  routeListeners.add(listener)
  return () => routeListeners.delete(listener)
}

export function parseHash(hash) {
  const raw = (hash || '').replace(/^#\/?/, '')
  const [path, query = ''] = raw.split('?')
  const view = VIEWS.includes(path) ? path : 'dashboard'
  return { view, params: Object.fromEntries(new URLSearchParams(query)) }
}

export function hrefFor(view, params = {}) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  }
  const q = search.toString()
  return `#/${view}${q ? `?${q}` : ''}`
}

/**
 * navigate('catalogue', { book: 17 }, { drawer: true }) pushes a history entry
 * marked as a drawer, so closing the drawer can simply go back.
 */
export function navigate(view, params = {}, { replace = false, drawer = false } = {}) {
  const href = hrefFor(view, params)
  if (href === window.location.hash && !replace) return
  window.history[replace ? 'replaceState' : 'pushState']({ drawer }, '', href)
  emitRoute()
}

export function closeDrawer(view, params = {}) {
  if (window.history.state && window.history.state.drawer) window.history.back()
  else navigate(view, params, { replace: true })
}

export function useRoute() {
  const hash = useSyncExternalStore(subscribeRoute, () => window.location.hash)
  return useMemo(() => parseHash(hash), [hash])
}
