import Avatar from '../components/Avatar.jsx'
import { hrefFor } from '../hooks.js'

/** Avatar + name (+ link to the member drawer) + card number. */
export function MemberCell({ id, name, card, link = true, size = 28 }) {
  return (
    <span className="person">
      <Avatar name={name} size={size} />
      <span className="person-text">
        {link ? (
          <a className="cell-title link-quiet" href={hrefFor('members', { member: id })}>
            {name}
          </a>
        ) : (
          <span className="cell-title">{name}</span>
        )}
        {card ? <span className="cell-sub mono">{card}</span> : null}
      </span>
    </span>
  )
}

/** Title (+ link to the book drawer) + barcode or author underneath. */
export function BookCell({ id, title, sub, mono = false, link = true }) {
  return (
    <span className="bookcell">
      {link ? (
        <a className="cell-title link-quiet" href={hrefFor('catalogue', { book: id })}>
          {title}
        </a>
      ) : (
        <span className="cell-title">{title}</span>
      )}
      {sub ? <span className={`cell-sub ${mono ? 'mono' : ''}`}>{sub}</span> : null}
    </span>
  )
}

/** A small card with a header; used across views. */
export function Panel({ title, icon, tone, count, action, children, className = '', bodyClass = '' }) {
  return (
    <section className={`card panel ${className}`}>
      <div className="card-head">
        <h2 className="card-title">
          {icon ? <span className={`card-title-icon tone-${tone || 'accent'}`}>{icon}</span> : null}
          <span>{title}</span>
          {count != null ? <span className="count-chip">{count}</span> : null}
        </h2>
        {action}
      </div>
      <div className={bodyClass}>{children}</div>
    </section>
  )
}
