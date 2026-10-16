import { useEffect, useState } from 'react'
import Button from './Button.jsx'
import Icon from './Icon.jsx'
import { LogoMark, Wordmark } from './Logo.jsx'
import { Spinner } from './States.jsx'

const RETRY_SECONDS = 10

/** Shown when /api/info cannot be loaded at start-up. Retries on its own. */
export default function FullPageError({ error, onRetry, retrying }) {
  const [seconds, setSeconds] = useState(RETRY_SECONDS)

  useEffect(() => {
    if (retrying) return undefined
    let left = RETRY_SECONDS
    setSeconds(left)
    const timer = setInterval(() => {
      left -= 1
      setSeconds(left)
      if (left <= 0) {
        clearInterval(timer)
        onRetry()
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [retrying, onRetry, error])

  const detail = error && error.status ? `HTTP ${error.status} · ${error.code}` : error ? error.code : ''

  return (
    <main className="fullpage">
      <div className="fullpage-card" role="alert">
        <div className="fullpage-brand">
          <LogoMark size={40} />
          <Wordmark />
        </div>
        <span className="fullpage-icon">
          <Icon name="serverOff" size={26} />
        </span>
        <h1 className="fullpage-title">The lending desk can’t reach its server</h1>
        <p className="fullpage-text">{error ? error.message : 'The ShelfWise API did not answer.'}</p>
        <div className="fullpage-actions">
          <Button variant="primary" icon="refresh" onClick={onRetry} busy={retrying}>
            {retrying ? 'Retrying…' : 'Retry now'}
          </Button>
          <span className="fullpage-countdown" aria-live="polite">
            {retrying ? 'Checking /api/info…' : `Trying again in ${seconds} s`}
          </span>
        </div>
        <div className="fullpage-ops">
          <div className="fullpage-ops-title">For whoever runs this desk</div>
          <p>
            The page loaded, but <code>GET /api/info</code> failed{detail ? <> with {detail}</> : null}. Check that the
            API answers <code>/ready</code> and that <code>/api</code> is routed to it. Nothing you entered has been lost.
          </p>
        </div>
      </div>
    </main>
  )
}

export function BootScreen() {
  return (
    <main className="fullpage" aria-busy="true">
      <div className="boot">
        <LogoMark size={48} />
        <div className="boot-text">
          <Spinner size={16} />
          <span>Opening the lending desk…</span>
        </div>
      </div>
    </main>
  )
}
