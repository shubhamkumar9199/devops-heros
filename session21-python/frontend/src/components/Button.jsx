import Icon from './Icon.jsx'
import { Spinner } from './States.jsx'

/**
 * <Button variant="primary|danger|danger-solid|ghost|subtle" size="sm" icon="plus" busy>Label</Button>
 * Icon-only buttons must pass aria-label.
 */
export default function Button({
  variant = 'default',
  size,
  icon,
  busy = false,
  disabled = false,
  className = '',
  type = 'button',
  children,
  ...rest
}) {
  const classes = [
    'btn',
    variant !== 'default' ? `btn-${variant}` : '',
    size ? `btn-${size}` : '',
    children ? '' : 'btn-icon',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  const iconSize = size === 'sm' ? 15 : 17
  return (
    <button type={type} className={classes} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <Spinner size={iconSize - 2} /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      {children ? <span className="btn-label">{children}</span> : null}
    </button>
  )
}
