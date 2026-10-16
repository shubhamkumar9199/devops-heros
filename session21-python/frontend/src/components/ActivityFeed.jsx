import { Fragment } from 'react'
import { hrefFor } from '../hooks.js'
import { dayHeading, dayKey, formatStamp, relativeTime } from '../format.js'
import Icon from './Icon.jsx'

const KINDS = {
  book_added: ['bookPlus', 'accent'],
  book_updated: ['pencil', 'grey'],
  book_deleted: ['trash', 'red'],
  copy_added: ['copies', 'accent'],
  copy_withdrawn: ['archive', 'grey'],
  member_joined: ['userPlus', 'accent'],
  member_left: ['userMinus', 'grey'],
  loan_created: ['arrowOut', 'blue'],
  loan_returned: ['arrowIn', 'green'],
  loan_renewed: ['renew', 'blue'],
  loan_lost: ['lost', 'red'],
  fine_paid: ['rupeeCircle', 'green'],
  hold_placed: ['bookmarkPlus', 'grey'],
  hold_ready: ['bell', 'amber'],
  hold_expired: ['hourglass', 'red'],
  hold_cancelled: ['bookmarkX', 'grey'],
}

/** Where an activity row leads: the member for people/loan events, the book otherwise. */
function linkFor(item) {
  const memberFirst = /^(member_|loan_|fine_)/.test(item.kind)
  if (memberFirst && item.member_id) return hrefFor('members', { member: item.member_id })
  if (item.book_id) return hrefFor('catalogue', { book: item.book_id })
  if (item.member_id) return hrefFor('members', { member: item.member_id })
  return null
}

/** Book titles arrive in “curly quotes”; set them in bold. */
function Message({ text }) {
  const parts = text.split(/(“[^”]+”)/g)
  return parts.map((part, i) =>
    part.startsWith('“') && part.endsWith('”') ? <strong key={i}>{part.slice(1, -1)}</strong> : <Fragment key={i}>{part}</Fragment>,
  )
}

export default function ActivityFeed({ items }) {
  const groups = []
  for (const item of items) {
    const key = dayKey(item.at)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(item)
    else groups.push({ key, heading: dayHeading(item.at), items: [item] })
  }
  return (
    <div className="feed">
      {groups.map((group) => (
        <section key={group.key} className="feed-group" aria-label={group.heading}>
          <h4 className="feed-day">{group.heading}</h4>
          <ol className="feed-list">
            {group.items.map((item) => {
              const [icon, tone] = KINDS[item.kind] || ['pulse', 'grey']
              const href = linkFor(item)
              const body = (
                <>
                  <span className={`feed-icon tone-${tone}`}>
                    <Icon name={icon} size={15} />
                  </span>
                  <span className="feed-msg">
                    <Message text={item.message} />
                  </span>
                  <time className="feed-time" dateTime={item.at} title={formatStamp(item.at)}>
                    {relativeTime(item.at)}
                  </time>
                </>
              )
              return (
                <li key={item.id} className="feed-item">
                  {href ? (
                    <a className="feed-row" href={href}>
                      {body}
                    </a>
                  ) : (
                    <div className="feed-row">{body}</div>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}
