import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { AppContext } from './context.js'
import { configureFormat, shortVersion } from './format.js'
import { useResource, useRoute } from './hooks.js'
import Button from './components/Button.jsx'
import ConfirmDialog from './components/ConfirmDialog.jsx'
import FullPageError, { BootScreen } from './components/FullPageError.jsx'
import Icon from './components/Icon.jsx'
import Sidebar from './components/Sidebar.jsx'
import { ToastViewport, useToasts } from './components/Toasts.jsx'
import Catalogue from './views/Catalogue.jsx'
import Dashboard from './views/Dashboard.jsx'
import HoldModal from './views/HoldModal.jsx'
import Holds from './views/Holds.jsx'
import LendModal from './views/LendModal.jsx'
import Loans from './views/Loans.jsx'
import Members from './views/Members.jsx'

const VIEW_TITLES = {
  dashboard: 'Dashboard',
  catalogue: 'Catalogue',
  members: 'Members',
  loans: 'Loans',
  holds: 'Holds',
}

export default function App() {
  const route = useRoute()
  const { toasts, dismiss, toast } = useToasts()
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  const info = useResource(() => api.info(), [], { interval: 30000 })
  const ready = Boolean(info.data)
  const stats = useResource(() => api.stats(), [version], { interval: 15000, enabled: ready })

  // Library time zone, currency and server clock, before anything formats a date.
  useMemo(() => {
    if (info.data) {
      configureFormat({
        timezone: info.data.timezone,
        currency: info.data.policy && info.data.policy.currency,
        serverTime: info.data.server_time,
      })
    }
  }, [info.data])

  // A rollout finished while the desk was open: say so.
  const seenVersion = useRef(null)
  useEffect(() => {
    const v = info.data && info.data.version
    if (!v) return
    if (seenVersion.current && seenVersion.current !== v) {
      toast.info(`The API is now running build ${shortVersion(v)} on pod ${info.data.pod}.`, 'New build is live')
    }
    seenVersion.current = v
  }, [info.data, toast])

  useEffect(() => {
    document.title = `${VIEW_TITLES[route.view]} · ShelfWise`
  }, [route.view])

  // Move focus to the page on view changes so keyboard and screen-reader users land on it.
  const mainRef = useRef(null)
  const lastView = useRef(route.view)
  useEffect(() => {
    if (lastView.current === route.view) return
    lastView.current = route.view
    window.scrollTo(0, 0)
    if (mainRef.current) mainRef.current.focus({ preventScroll: true })
  }, [route.view])

  const [lend, setLend] = useState(null)
  const [hold, setHold] = useState(null)
  const [confirmState, setConfirmState] = useState(null)

  const confirm = useCallback((options) => new Promise((resolve) => setConfirmState({ ...options, resolve })), [])
  const answer = (value) => {
    if (confirmState) confirmState.resolve(value)
    setConfirmState(null)
  }

  const run = useCallback(
    async (fn, { success, failure } = {}) => {
      try {
        const result = await fn()
        if (success) toast.success(typeof success === 'function' ? success(result) : success)
        bump()
        return { ok: true, result }
      } catch (error) {
        toast.error(error, failure)
        // A refusal often means the screen was stale: reload everything.
        if (error && (error.status === 404 || error.status === 409)) bump()
        return { ok: false, error }
      }
    },
    [toast, bump],
  )

  const reloadInfo = info.reload
  const reloadStats = stats.reload
  const online = !info.error && !stats.error
  const ctx = useMemo(
    () => ({
      info: info.data,
      policy: info.data ? info.data.policy : null,
      stats: stats.data,
      reloadStats,
      version,
      bump,
      run,
      toast,
      confirm,
      online,
      openLend: (preset = {}) => setLend(preset),
      openHold: (preset = {}) => setHold(preset),
    }),
    [info.data, stats.data, reloadStats, version, bump, run, toast, confirm, online],
  )

  if (!info.data) {
    return (
      <>
        {info.error ? <FullPageError error={info.error} onRetry={reloadInfo} retrying={info.loading} /> : <BootScreen />}
        <ToastViewport toasts={toasts} dismiss={dismiss} />
      </>
    )
  }

  const { view, params } = route

  return (
    <AppContext.Provider value={ctx}>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); mainRef.current?.focus() }}>
        Skip to content
      </a>
      <div className="app">
        <Sidebar view={view} info={info.data} stats={stats.data} online={online} onLend={() => setLend({})} />
        <main id="main" ref={mainRef} className="main" tabIndex={-1}>
          {!online ? (
            <div className="offline-banner" role="status">
              <Icon name="serverOff" size={18} />
              <span>
                <strong>Connection to the server lost.</strong> Showing the last data loaded; retrying in the background.
              </span>
              <Button
                size="sm"
                icon="refresh"
                onClick={() => {
                  reloadInfo()
                  reloadStats()
                  bump()
                }}
              >
                Retry now
              </Button>
            </div>
          ) : null}
          {view === 'dashboard' ? <Dashboard /> : null}
          {view === 'catalogue' ? <Catalogue params={params} /> : null}
          {view === 'members' ? <Members params={params} /> : null}
          {view === 'loans' ? <Loans params={params} /> : null}
          {view === 'holds' ? <Holds /> : null}
        </main>
      </div>
      {lend ? <LendModal preset={lend} onClose={() => setLend(null)} /> : null}
      {hold ? <HoldModal preset={hold} onClose={() => setHold(null)} /> : null}
      {confirmState ? <ConfirmDialog {...confirmState} onAnswer={answer} /> : null}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </AppContext.Provider>
  )
}
