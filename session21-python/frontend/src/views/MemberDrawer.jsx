import { useState } from 'react'
import { api } from '../api.js'
import Avatar from '../components/Avatar.jsx'
import Button from '../components/Button.jsx'
import Drawer, { DrawerSection } from '../components/Drawer.jsx'
import Icon from '../components/Icon.jsx'
import { ErrorState, Skeleton, SkeletonLines } from '../components/States.jsx'
import { LoanStatus, memberState, Pill, TypeBadge } from '../components/StatusPill.jsx'
import { useApp } from '../context.js'
import { daysSince, dueInfo, formatDate, formatDay, formatMoney, formatShort, pickupInfo, plural } from '../format.js'
import { hrefFor, useResource } from '../hooks.js'
import { LoanActionButtons, useLoanActions } from './loanActions.jsx'
import MemberFormModal from './MemberFormModal.jsx'

export default function MemberDrawer({ id, onClose }) {
  const { version, run, confirm, openLend, openHold, policy } = useApp()
  const detail = useResource(() => api.member(id), [id, version])
  const loanActions = useLoanActions()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(null)
  const member = detail.data

  if (!member) {
    return (
      <Drawer
        eyebrow="Member"
        title={detail.error ? 'Member unavailable' : <Skeleton width="60%" height={22} />}
        label={detail.error ? undefined : 'Loading member'}
        onClose={onClose}
      >
        {detail.error ? (
          <ErrorState
            error={detail.error}
            onRetry={detail.error.status === 404 ? undefined : detail.reload}
            title="Could not load this member"
          />
        ) : (
          <div className="card card-body">
            <SkeletonLines lines={6} />
          </div>
        )}
      </Drawer>
    )
  }

  const act = async (key, fn, options) => {
    setBusy(key)
    try {
      return await run(fn, options)
    } finally {
      setBusy(null)
    }
  }

  const active = member.loans.filter((l) => l.status === 'active')
  const closed = member.loans.filter((l) => l.status !== 'active')
  const unpaid = closed.filter((l) => l.fine_amount > 0 && !l.fine_paid)
  const state = memberState(member, policy)

  const closeMembership = async () => {
    const ok = await confirm({
      title: `Close ${member.name}’s membership?`,
      message: `Card ${member.card_number} stops working and any open holds are cancelled. Members with books out or unpaid fines must settle up first.`,
      confirmLabel: 'Close membership',
      icon: 'userMinus',
    })
    if (!ok) return
    await act('close', () => api.closeMember(member.id), {
      success: `${member.name}’s membership is closed.`,
      failure: `Couldn’t close ${member.name}’s membership`,
    })
  }

  const cancelHold = async (hold) => {
    const ok = await confirm({
      title: `Cancel the hold on “${hold.book_title}”?`,
      message:
        hold.status === 'ready'
          ? `The reserved copy ${hold.copy_barcode} passes to the next member waiting, or goes back on the shelf.`
          : `${member.name} leaves the queue at position ${hold.position}.`,
      confirmLabel: 'Cancel hold',
      cancelLabel: 'Keep hold',
      icon: 'bookmarkX',
    })
    if (!ok) return
    await act(`cancel-${hold.id}`, () => api.cancelHold(hold.id), {
      success: `${member.name}’s hold on “${hold.book_title}” was cancelled.`,
      failure: 'Couldn’t cancel the hold',
    })
  }

  const checkout = (hold) =>
    act(`checkout-${hold.id}`, () => api.lend({ member_id: member.id, book_id: hold.book_id }), {
      success: (loan) => `${loan.barcode} checked out to ${loan.member_name}. Due ${formatDay(loan.due_at)}.`,
      failure: `Couldn’t check out “${hold.book_title}”`,
    })

  const statusNotice = !member.is_active ? (
    <div className="notice tone-grey">
      <Icon name="userMinus" size={16} />
      <span>This membership is closed. The record and lending history are kept.</span>
    </div>
  ) : member.blocked_reason ? (
    <div className={`notice tone-${state.tone}`}>
      <Icon name={state.tone === 'red' ? 'ban' : 'alert'} size={16} />
      <span>
        <strong>{state.label}.</strong> {member.blocked_reason}
      </span>
    </div>
  ) : (
    <div className="notice tone-green">
      <Icon name="checkCircle" size={16} />
      <span>
        In good standing: can borrow {plural(member.max_loans - member.loans_active, 'more book')} for{' '}
        {policy.members[member.member_type].loan_days} days.
      </span>
    </div>
  )

  return (
    <Drawer
      eyebrow={
        <>
          <TypeBadge type={member.member_type} /> <span className="mono">{member.card_number}</span>
        </>
      }
      title={
        <span className="drawer-title-person">
          <Avatar name={member.name} size={36} />
          <span>{member.name}</span>
        </span>
      }
      subtitle={
        <>
          <span>{member.email}</span>
          <span className="drawer-meta">Member since {formatDate(member.created_at)}</span>
        </>
      }
      onClose={onClose}
      actions={
        member.is_active ? (
          <>
            <Button variant="primary" icon="arrowOut" onClick={() => openLend({ memberId: member.id })}>
              Lend a book
            </Button>
            <Button icon="bookmarkPlus" onClick={() => openHold({ memberId: member.id })}>
              Place hold
            </Button>
            <Button icon="pencil" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="danger" icon="userMinus" busy={busy === 'close'} onClick={closeMembership}>
              Close membership
            </Button>
          </>
        ) : (
          <Button icon="pencil" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )
      }
    >
      {statusNotice}

      <div className="statstrip">
        <div className="stat">
          <span className="stat-label">Loans</span>
          <span className="stat-value">
            {member.loans_active}
            <span className="stat-of"> / {member.max_loans}</span>
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Overdue</span>
          <span className={`stat-value ${member.loans_overdue ? 'tone-text-red' : ''}`}>{member.loans_overdue}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Fines owed</span>
          <span className={`stat-value ${member.fines_outstanding >= policy.fine_block_at ? 'tone-text-red' : ''}`}>
            {formatMoney(member.fines_outstanding)}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Holds</span>
          <span className="stat-value">{member.holds.length}</span>
        </div>
      </div>

      <DrawerSection title="On loan" count={active.length}>
        {active.length === 0 ? (
          <p className="section-empty">No books out right now.</p>
        ) : (
          <ul className="rowlist">
            {active.map((loan) => {
              const due = dueInfo(loan)
              return (
                <li key={loan.id} className={`rowlist-item loan-row ${loan.is_overdue ? 'is-overdue' : ''}`}>
                  <div className="loan-main">
                    <a className="cell-title link-quiet" href={hrefFor('catalogue', { book: loan.book_id })}>
                      {loan.book_title}
                    </a>
                    <span className="cell-sub">
                      <span className="mono">{loan.barcode}</span> · borrowed {formatShort(loan.borrowed_at)} · due{' '}
                      {formatShort(loan.due_at)}
                    </span>
                    <span className="loan-tags">
                      {due ? <Pill tone={due.tone === 'muted' ? 'grey' : due.tone}>{due.text}</Pill> : null}
                      {loan.fine_amount ? (
                        <span className="cell-sub tone-text-red">{formatMoney(loan.fine_amount)} so far</span>
                      ) : null}
                      <span className="cell-sub">{plural(loan.renewals_left, 'renewal')} left</span>
                    </span>
                  </div>
                  <LoanActionButtons loan={loan} actions={loanActions} />
                </li>
              )
            })}
          </ul>
        )}
      </DrawerSection>

      <DrawerSection title="Holds" count={member.holds.length}>
        {member.holds.length === 0 ? (
          <p className="section-empty">Not waiting for any title.</p>
        ) : (
          <ul className="rowlist">
            {member.holds.map((hold) => {
              const pickup = pickupInfo(hold)
              return (
                <li key={hold.id} className="rowlist-item queue-row">
                  <span className={`queue-pos ${hold.status === 'ready' ? 'is-ready' : ''}`} aria-hidden="true">
                    {hold.status === 'ready' ? <Icon name="bell" size={14} /> : `#${hold.position}`}
                  </span>
                  <div className="queue-main">
                    <a className="cell-title link-quiet" href={hrefFor('catalogue', { book: hold.book_id })}>
                      {hold.book_title}
                    </a>
                    <div className="cell-sub">
                      {hold.status === 'ready' ? (
                        <>
                          Ready: {hold.copy_barcode} on the hold shelf until {formatDay(hold.expires_at)}
                          {pickup ? <span className={`tone-text-${pickup.tone}`}> · {pickup.text}</span> : null}
                        </>
                      ) : (
                        <>
                          Position {hold.position} in the queue · waiting {plural(daysSince(hold.placed_at), 'day')}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="row-actions">
                    {hold.status === 'ready' ? (
                      <Button size="sm" variant="primary" icon="arrowOut" busy={busy === `checkout-${hold.id}`} onClick={() => checkout(hold)}>
                        Check out
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" busy={busy === `cancel-${hold.id}`} onClick={() => cancelHold(hold)}>
                      Cancel
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </DrawerSection>

      <DrawerSection
        title="History"
        count={closed.length}
        action={unpaid.length ? <Pill tone="red">{plural(unpaid.length, 'unpaid fine')}</Pill> : null}
      >
        {closed.length === 0 ? (
          <p className="section-empty">No returned loans yet.</p>
        ) : (
          <ul className="rowlist">
            {closed.map((loan) => (
              <li key={loan.id} className="rowlist-item loan-row">
                <div className="loan-main">
                  <a className="cell-title link-quiet" href={hrefFor('catalogue', { book: loan.book_id })}>
                    {loan.book_title}
                  </a>
                  <span className="cell-sub">
                    <span className="mono">{loan.barcode}</span> · {formatShort(loan.borrowed_at)} → {formatShort(loan.closed_at)}
                    {loan.status === 'returned' && loan.days_overdue ? ` · ${plural(loan.days_overdue, 'day')} late` : ''}
                  </span>
                  <span className="loan-tags">
                    <LoanStatus loan={loan} />
                    {loan.fine_amount ? (
                      <span className={`cell-sub ${loan.fine_paid ? '' : 'tone-text-red'}`}>
                        {loan.status === 'lost' ? 'Replacement fee' : 'Late fine'} {formatMoney(loan.fine_amount)}
                        {loan.fine_paid ? ' · paid' : ' · unpaid'}
                      </span>
                    ) : null}
                  </span>
                </div>
                <LoanActionButtons loan={loan} actions={loanActions} />
              </li>
            ))}
          </ul>
        )}
      </DrawerSection>

      {editing ? <MemberFormModal member={member} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} /> : null}
    </Drawer>
  )
}
