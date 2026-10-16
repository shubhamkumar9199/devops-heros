import { capitalise, formatMoney, plural } from '../format.js'

export function Pill({ tone = 'grey', children, title, dot = true, className = '' }) {
  return (
    <span className={`pill pill-${tone} ${className}`} title={title}>
      {dot ? <span className="pill-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  )
}

const COPY_STATUS = {
  available: ['green', 'On shelf'],
  on_loan: ['blue', 'On loan'],
  on_hold_shelf: ['amber', 'Hold shelf'],
  lost: ['red', 'Lost'],
  withdrawn: ['grey', 'Withdrawn'],
}

const HOLD_STATUS = {
  waiting: ['grey', 'Waiting'],
  ready: ['amber', 'Ready'],
  fulfilled: ['green', 'Collected'],
  cancelled: ['grey', 'Cancelled'],
  expired: ['red', 'Expired'],
}

export function CopyStatus({ status }) {
  const [tone, label] = COPY_STATUS[status] || ['grey', capitalise(status)]
  return <Pill tone={tone}>{label}</Pill>
}

export function HoldStatus({ status }) {
  const [tone, label] = HOLD_STATUS[status] || ['grey', capitalise(status)]
  return <Pill tone={tone}>{label}</Pill>
}

export function LoanStatus({ loan }) {
  if (loan.status === 'active') {
    return loan.is_overdue ? <Pill tone="red">Overdue</Pill> : <Pill tone="blue">On loan</Pill>
  }
  if (loan.status === 'lost') return <Pill tone="red">Lost</Pill>
  return <Pill tone="grey">Returned</Pill>
}

/** "2 of 3 on shelf", "0 of 1 · 2 waiting", "No copies" */
export function Availability({ book }) {
  const total = book.copies_total
  const available = book.copies_available
  const waiting = book.holds_waiting
  if (!total) {
    return (
      <Pill tone="grey" title="No copies in circulation">
        No copies
      </Pill>
    )
  }
  if (available > 0) {
    return (
      <Pill tone="green" title={`${plural(available, 'copy', 'copies')} on the shelf`}>
        {available} of {total} on shelf
      </Pill>
    )
  }
  return (
    <Pill tone="amber" title={waiting ? `${plural(waiting, 'member')} waiting in the hold queue` : 'Every copy is out'}>
      0 of {total}
      {waiting ? ` · ${waiting} waiting` : ' on shelf'}
    </Pill>
  )
}

/** Why a member cannot borrow, classified for a pill. */
export function memberState(member, policy) {
  if (!member.is_active) return { tone: 'grey', label: 'Closed' }
  if (member.can_borrow) return { tone: 'green', label: 'Can borrow' }
  if (member.loans_overdue > 0) return { tone: 'red', label: 'Overdue loans' }
  if (policy && member.fines_outstanding >= policy.fine_block_at) return { tone: 'red', label: 'Fines due' }
  if (member.loans_active >= member.max_loans) return { tone: 'amber', label: 'At loan limit' }
  return { tone: 'amber', label: 'Blocked' }
}

export function MemberStatus({ member, policy }) {
  const { tone, label } = memberState(member, policy)
  return (
    <Pill tone={tone} title={member.blocked_reason || undefined}>
      {label}
    </Pill>
  )
}

/** The server's blocked sentence without the leading name, for compact rows. */
export function shortReason(member) {
  const reason = member.blocked_reason
  if (!reason) return ''
  const trimmed = reason.startsWith(member.name) ? reason.slice(member.name.length).trim() : reason
  return capitalise(trimmed)
}

export function TypeBadge({ type }) {
  return <span className={`badge badge-${type}`}>{capitalise(type)}</span>
}

/** Money with a tone: red at/over the blocking threshold, amber when owed, muted when zero. */
export function Fine({ amount, blockAt }) {
  if (!amount) return <span className="muted">—</span>
  const tone = blockAt && amount >= blockAt ? 'red' : 'amber'
  return <span className={`money tone-text-${tone}`}>{formatMoney(amount)}</span>
}
