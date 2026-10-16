import { useId } from 'react'
import { createPortal } from 'react-dom'
import { useLayer } from '../layers.js'
import Button from './Button.jsx'
import Icon from './Icon.jsx'

/** Small "are you sure?" dialog. Focus starts on Cancel, the safe choice. */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  icon,
  onAnswer,
}) {
  const { panelRef, index, isTop } = useLayer(() => onAnswer(false))
  const titleId = useId()
  const descId = useId()
  return createPortal(
    <div className="layer layer-modal" style={{ zIndex: 100 + index * 10 }} inert={!isTop}>
      <div className="layer-backdrop" onClick={() => onAnswer(false)} aria-hidden="true" />
      <section
        ref={panelRef}
        className="modal modal-sm confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
      >
        <div className="confirm-body">
          <span className={`confirm-icon tone-${tone === 'danger' ? 'red' : 'accent'}`}>
            <Icon name={icon || (tone === 'danger' ? 'alert' : 'info')} size={20} />
          </span>
          <div>
            <h2 id={titleId} className="modal-title">
              {title}
            </h2>
            <div id={descId} className="confirm-text">
              {message}
            </div>
          </div>
        </div>
        <footer className="modal-foot">
          <Button onClick={() => onAnswer(false)} data-autofocus="">
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger-solid' : 'primary'} onClick={() => onAnswer(true)}>
            {confirmLabel}
          </Button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
