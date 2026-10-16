// Option renderers and matchers shared by the Lend and Place-hold modals.
import Avatar from '../components/Avatar.jsx'
import Icon from '../components/Icon.jsx'
import { Availability, memberState, Pill } from '../components/StatusPill.jsx'
import { capitalise, formatMoney } from '../format.js'

export const memberKey = (m) => m.id
export const memberLabel = (m) => `${m.name} · ${m.card_number}`
export const matchMember = (m, q) =>
  m.name.toLowerCase().includes(q) || m.card_number.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)

export const bookKey = (b) => b.id
export const bookLabel = (b) => b.title
export const matchBook = (b, q) =>
  b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q) || b.isbn.includes(q.replaceAll('-', ''))

export function MemberOption({ member, policy }) {
  const state = memberState(member, policy)
  return (
    <>
      <Avatar name={member.name} size={28} />
      <span className="opt-text">
        <span className="opt-title">{member.name}</span>
        <span className="opt-sub">
          {member.card_number} · {capitalise(member.member_type)} · {member.loans_active}/{member.max_loans} loans
        </span>
      </span>
      {member.can_borrow ? null : <Pill tone={state.tone}>{state.label}</Pill>}
    </>
  )
}

export function BookOption({ book }) {
  return (
    <>
      <span className="opt-text">
        <span className="opt-title">{book.title}</span>
        <span className="opt-sub">{book.author}</span>
      </span>
      <Availability book={book} />
    </>
  )
}

/** What the desk should know about the chosen member before submitting. */
export function MemberNote({ member, policy }) {
  if (!member.can_borrow) {
    const state = memberState(member, policy)
    return (
      <div className={`picked tone-${state.tone}`}>
        <Icon name={state.tone === 'red' ? 'ban' : 'alert'} size={16} />
        <span>
          {member.blocked_reason}. <span className="muted">The server will refuse this unless that changes.</span>
        </span>
      </div>
    )
  }
  return (
    <div className="picked tone-green">
      <Icon name="checkCircle" size={16} />
      <span>
        {member.loans_active} of {member.max_loans} loans in use
        {member.fines_outstanding ? ` · owes ${formatMoney(member.fines_outstanding)}` : ' · no fines'}
      </span>
    </div>
  )
}
