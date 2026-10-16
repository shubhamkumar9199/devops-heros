import Icon from './Icon.jsx'

/** aria-describedby for an input inside <Field id=...>. */
export function describedBy(id, error, hint) {
  if (error) return `${id}-error`
  if (hint) return `${id}-hint`
  return undefined
}

/** Label + control + hint/error, wired for screen readers. */
export function Field({ id, label, hint, error, optional = false, className = '', children }) {
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className}`}>
      <label className="field-label" htmlFor={id}>
        {label}
        {optional ? <span className="field-optional">Optional</span> : null}
      </label>
      {children}
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          <Icon name="alertCircle" size={14} />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function Switch({ id, checked, onChange, label }) {
  return (
    <label className="switch" htmlFor={id}>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">{label}</span>
    </label>
  )
}

export function SearchInput({ id, value, onChange, placeholder, label }) {
  return (
    <div className="search">
      <Icon name="search" size={16} className="search-icon" />
      <input
        id={id}
        type="search"
        className="input search-input"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        spellCheck="false"
        onChange={(e) => onChange(e.target.value)}
      />
      {value ? (
        <button type="button" className="search-clear" aria-label="Clear search" onClick={() => onChange('')}>
          <Icon name="x" size={14} />
        </button>
      ) : null}
    </div>
  )
}

/** Inline alert box used inside forms for server refusals. */
export function FormAlert({ title, children, action, tone = 'red' }) {
  return (
    <div className={`form-alert tone-${tone}`} role="alert">
      <Icon name={tone === 'red' ? 'alertCircle' : 'info'} size={18} className="form-alert-icon" />
      <div className="form-alert-body">
        {title ? <div className="form-alert-title">{title}</div> : null}
        <div className="form-alert-text">{children}</div>
        {action ? <div className="form-alert-action">{action}</div> : null}
      </div>
    </div>
  )
}
