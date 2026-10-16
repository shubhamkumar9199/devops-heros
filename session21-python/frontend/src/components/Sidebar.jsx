import { formatClock, now, shortVersion, timeZone } from '../format.js'
import { useTicker } from '../hooks.js'
import Icon from './Icon.jsx'
import { LogoMark, Wordmark } from './Logo.jsx'

const UI_VERSION = import.meta.env.VITE_APP_VERSION || ''

const NAV = [
  { view: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { view: 'catalogue', label: 'Catalogue', icon: 'books' },
  { view: 'members', label: 'Members', icon: 'users' },
  { view: 'loans', label: 'Loans', icon: 'loans', badge: 'loans_overdue', tone: 'red', badgeText: 'overdue' },
  { view: 'holds', label: 'Holds', icon: 'holds', badge: 'holds_ready', tone: 'amber', badgeText: 'ready for pickup' },
]

/** Which build and pod answered /api/info: the visible proof of a rollout. */
function BuildInfo({ info, online }) {
  useTicker(30000)
  const version = (info && info.version) || UI_VERSION || 'dev'
  const pod = (info && info.pod) || 'unknown'
  const tooltip = [
    `API build: ${version}`,
    `Served by pod: ${pod}`,
    UI_VERSION ? `UI build: ${UI_VERSION}` : null,
    `Library time zone: ${timeZone()}`,
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <div className="build" title={tooltip}>
      <div className="build-status">
        <span className={`status-dot ${online ? 'is-online' : 'is-offline'}`} aria-hidden="true" />
        <span>{online ? 'Connected' : 'Reconnecting…'}</span>
        <span className="build-clock">{formatClock(now())}</span>
      </div>
      <div className="build-line">
        <span className="build-key">Build</span> <code className="build-version">{shortVersion(version)}</code>
      </div>
      <div className="build-line build-pod-line">
        <span className="build-key">pod</span> <code className="build-pod">{pod}</code>
      </div>
    </div>
  )
}

/** Compact build badge for the phone top bar. */
function BuildChip({ info, online }) {
  const version = (info && info.version) || UI_VERSION || 'dev'
  const pod = (info && info.pod) || ''
  const podTail = pod.split('-').slice(-2).join('-')
  return (
    <div className="build-chip" title={`Build ${version} · pod ${pod}`}>
      <span className={`status-dot ${online ? 'is-online' : 'is-offline'}`} aria-hidden="true" />
      <span className="build-chip-text">
        <span>
          Build <code>{shortVersion(version)}</code>
        </span>
        {podTail ? (
          <span className="build-chip-pod">
            pod <code>{podTail}</code>
          </span>
        ) : null}
      </span>
    </div>
  )
}

export default function Sidebar({ view, info, stats, online, onLend }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <a className="brand" href="#/dashboard" aria-label="ShelfWise dashboard">
          <LogoMark size={34} />
          <span className="brand-text">
            <Wordmark />
            <span className="brand-tag">Lending desk</span>
          </span>
        </a>
        <BuildChip info={info} online={online} />
      </div>

      <button type="button" className="sidebar-lend" onClick={onLend}>
        <Icon name="plus" size={17} />
        <span>Lend a book</span>
      </button>

      <nav className="nav" aria-label="Main">
        <div className="nav-heading">Desk</div>
        {NAV.map((item) => {
          const count = item.badge && stats ? stats[item.badge] : 0
          return (
            <a
              key={item.view}
              href={`#/${item.view}`}
              className="nav-item"
              aria-current={view === item.view ? 'page' : undefined}
            >
              <span className="nav-icon">
                <Icon name={item.icon} size={19} />
                {count ? <span className={`nav-dot tone-${item.tone}`} aria-hidden="true" /> : null}
              </span>
              <span className="nav-label">{item.label}</span>
              {count ? (
                <span className={`nav-badge tone-${item.tone}`}>
                  {count}
                  <span className="sr-only"> {item.badgeText}</span>
                </span>
              ) : null}
            </a>
          )
        })}
      </nav>

      <BuildInfo info={info} online={online} />
    </aside>
  )
}
