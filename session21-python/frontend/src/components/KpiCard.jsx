import Icon from './Icon.jsx'
import { Skeleton } from './States.jsx'

/** Stat tile: label, value, one line of context. Optional link to the detail view. */
export default function KpiCard({ label, value, sub, icon, tone = 'accent', href, loading = false, alert = false }) {
  const body = (
    <>
      <div className="kpi-head">
        <span className="kpi-label">{label}</span>
        <span className={`kpi-icon tone-${tone}`}>
          <Icon name={icon} size={16} />
        </span>
      </div>
      <div className="kpi-value">{loading ? <Skeleton width="55%" height={28} /> : value}</div>
      <div className="kpi-sub">{loading ? <Skeleton width="80%" height={10} /> : sub}</div>
    </>
  )
  const classes = `card kpi ${alert ? `kpi-alert tone-${tone}` : ''} ${href ? 'kpi-link' : ''}`
  if (href) {
    return (
      <a className={classes} href={href}>
        {body}
      </a>
    )
  }
  return <div className={classes}>{body}</div>
}
