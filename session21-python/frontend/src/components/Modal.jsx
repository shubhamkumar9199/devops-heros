import { useId } from 'react'
import { createPortal } from 'react-dom'
import { useLayer } from '../layers.js'
import Icon from './Icon.jsx'

/**
 * Centred dialog (bottom sheet on phones). Pass onSubmit to wrap the body and
 * footer in a <form>, so Enter submits. While busy, Esc and backdrop clicks
 * are ignored.
 */
export default function Modal({
  title,
  description,
  onClose,
  onSubmit,
  footer,
  children,
  size = 'md',
  role = 'dialog',
  busy = false,
}) {
  const close = busy ? undefined : onClose
  const { panelRef, index, isTop } = useLayer(close)
  const titleId = useId()
  const descId = useId()

  const inner = (
    <>
      <div className="modal-body">{children}</div>
      {footer ? <footer className="modal-foot">{footer}</footer> : null}
    </>
  )

  return createPortal(
    <div className="layer layer-modal" style={{ zIndex: 100 + index * 10 }} inert={!isTop}>
      <div className="layer-backdrop" onClick={close} aria-hidden="true" />
      <section
        ref={panelRef}
        className={`modal modal-${size}`}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
      >
        <header className="modal-head">
          <div className="modal-heading">
            <h2 id={titleId} className="modal-title">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="modal-desc">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon modal-close"
            aria-label="Close dialog"
            onClick={close}
            disabled={busy}
          >
            <Icon name="x" size={18} />
          </button>
        </header>
        {onSubmit ? (
          <form className="modal-form" onSubmit={onSubmit} noValidate>
            {inner}
          </form>
        ) : (
          inner
        )}
      </section>
    </div>,
    document.body,
  )
}
