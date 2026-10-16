import { useId } from 'react'
import { createPortal } from 'react-dom'
import { useLayer } from '../layers.js'
import Icon from './Icon.jsx'

/** Side panel on wide screens, full-screen sheet on phones. Esc / backdrop close it. */
export default function Drawer({ eyebrow, title, subtitle, actions, onClose, children, label }) {
  const { panelRef, index, isTop } = useLayer(onClose, { focusPanel: true })
  const titleId = useId()
  return createPortal(
    <div className="layer layer-drawer" style={{ zIndex: 100 + index * 10 }} inert={!isTop}>
      <div className="layer-backdrop" onClick={onClose} aria-hidden="true" />
      <section
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={label ? undefined : titleId}
        aria-label={label}
        tabIndex={-1}
      >
        <header className="drawer-head">
          <div className="drawer-head-row">
            <div className="drawer-heading">
              {eyebrow ? <div className="drawer-eyebrow">{eyebrow}</div> : null}
              <h2 id={titleId} className="drawer-title">
                {title}
              </h2>
              {subtitle ? <div className="drawer-subtitle">{subtitle}</div> : null}
            </div>
            <button type="button" className="btn btn-ghost btn-icon drawer-close" aria-label="Close panel" onClick={onClose}>
              <Icon name="x" size={18} />
            </button>
          </div>
          {actions ? <div className="drawer-actions">{actions}</div> : null}
        </header>
        <div className="drawer-body">{children}</div>
      </section>
    </div>,
    document.body,
  )
}

export function DrawerSection({ title, count, action, children }) {
  return (
    <section className="dsection">
      <div className="dsection-head">
        <h3 className="dsection-title">
          {title}
          {count != null ? <span className="dsection-count">{count}</span> : null}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}
