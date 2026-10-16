import Icon from './Icon.jsx'

export function Spinner({ size = 16, label }) {
  return (
    <span
      className="spinner"
      style={{ width: size, height: size }}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
    />
  )
}

export function Skeleton({ width = '100%', height = 12, radius, className = '' }) {
  return <span className={`skel ${className}`} style={{ width, height, borderRadius: radius }} aria-hidden="true" />
}

/** A few placeholder lines, e.g. while a drawer section loads. */
export function SkeletonLines({ lines = 3 }) {
  return (
    <div className="skel-lines" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={`${92 - ((i * 17) % 40)}%`} height={12} />
      ))}
    </div>
  )
}

export function EmptyState({ icon = 'inbox', title, children, action, tone, compact = false }) {
  return (
    <div className={`empty ${compact ? 'empty-compact' : ''}`}>
      <span className={`empty-icon ${tone ? `tone-${tone}` : ''}`}>
        <Icon name={icon} size={compact ? 18 : 22} />
      </span>
      <div className="empty-title">{title}</div>
      {children ? <div className="empty-text">{children}</div> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  )
}

/** Inline error for a panel whose data could not be loaded. */
export function ErrorState({ error, onRetry, title = 'Could not load this', compact = false }) {
  const offline = error && (error.status === 0 || error.status >= 500)
  return (
    <div className={`empty error-state ${compact ? 'empty-compact' : ''}`} role="alert">
      <span className="empty-icon tone-red">
        <Icon name={offline ? 'serverOff' : 'alertCircle'} size={compact ? 18 : 22} />
      </span>
      <div className="empty-title">{offline ? 'The server is not answering' : title}</div>
      <div className="empty-text">{error ? error.message : 'Something went wrong.'}</div>
      {onRetry ? (
        <div className="empty-action">
          <button type="button" className="btn btn-sm" onClick={onRetry}>
            <Icon name="refresh" size={15} />
            <span className="btn-label">Try again</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
