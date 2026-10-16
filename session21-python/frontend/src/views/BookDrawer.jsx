import { useState } from 'react'
import { api } from '../api.js'
import Button from '../components/Button.jsx'
import Drawer, { DrawerSection } from '../components/Drawer.jsx'
import Icon from '../components/Icon.jsx'
import { EmptyState, ErrorState, Skeleton, SkeletonLines } from '../components/States.jsx'
import { Availability, CopyStatus, LoanStatus } from '../components/StatusPill.jsx'
import { useApp } from '../context.js'
import { capitalise, daysSince, dueInfo, formatDay, formatMoney, formatShort, pickupInfo, plural } from '../format.js'
import { hrefFor, useResource } from '../hooks.js'
import BookFormModal from './BookFormModal.jsx'
import CopyFormModal from './CopyFormModal.jsx'

export default function BookDrawer({ id, onClose }) {
  const { version, run, confirm, openLend, openHold, policy } = useApp()
  const detail = useResource(() => api.book(id), [id, version])
  const loans = useResource(() => api.loans({ book_id: id, status: 'all', limit: 40 }), [id, version])
  const [editing, setEditing] = useState(false)
  const [copyForm, setCopyForm] = useState(null)
  const [busy, setBusy] = useState(null)
  const book = detail.data

  if (!book) {
    return (
      <Drawer
        eyebrow="Book"
        title={detail.error ? 'Book unavailable' : <Skeleton width="70%" height={22} />}
        label={detail.error ? undefined : 'Loading book'}
        onClose={onClose}
      >
        {detail.error ? (
          <ErrorState
            error={detail.error}
            onRetry={detail.error.status === 404 ? undefined : detail.reload}
            title="Could not load this book"
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

  const history = loans.data || []
  const activeByCopy = new Map(history.filter((l) => l.status === 'active').map((l) => [l.copy_id, l]))
  const closed = history.filter((l) => l.status !== 'active').slice(0, 8)
  const circulating = book.copies_total
  const canLend = book.copies_available > 0
  const canHold = !canLend && circulating > 0
  const shelfCount = book.copies.filter((c) => c.status === 'on_hold_shelf').length

  const deleteBook = async () => {
    const ok = await confirm({
      title: `Delete “${book.title}”?`,
      message: `This removes the title and its ${plural(book.copies.length, 'copy', 'copies')} from the catalogue. Titles with lending history stay; withdraw their copies instead.`,
      confirmLabel: 'Delete book',
    })
    if (!ok) return
    const result = await act('delete', () => api.deleteBook(book.id), {
      success: `“${book.title}” was removed from the catalogue.`,
      failure: `Couldn’t delete “${book.title}”`,
    })
    if (result.ok) onClose()
  }

  const withdraw = async (copy) => {
    const ok = await confirm({
      title: `Withdraw ${copy.barcode}?`,
      message: `This copy of “${book.title}” leaves circulation for good. It stays on record as withdrawn.`,
      confirmLabel: 'Withdraw copy',
      icon: 'archive',
    })
    if (!ok) return
    await act(`withdraw-${copy.id}`, () => api.withdrawCopy(copy.id), {
      success: `${copy.barcode} was withdrawn from circulation.`,
      failure: `Couldn’t withdraw ${copy.barcode}`,
    })
  }

  const checkout = (hold) =>
    act(`checkout-${hold.id}`, () => api.lend({ member_id: hold.member_id, book_id: book.id }), {
      success: (loan) => `${loan.barcode} checked out to ${loan.member_name}. Due ${formatDay(loan.due_at)}.`,
      failure: `Couldn’t check out to ${hold.member_name}`,
    })

  const cancelHold = async (hold) => {
    const ok = await confirm({
      title: `Cancel ${hold.member_name}’s hold?`,
      message:
        hold.status === 'ready'
          ? `The reserved copy ${hold.copy_barcode} passes to the next member waiting, or goes back on the shelf.`
          : `${hold.member_name} leaves the queue for “${book.title}”.`,
      confirmLabel: 'Cancel hold',
      cancelLabel: 'Keep hold',
      icon: 'bookmarkX',
    })
    if (!ok) return
    await act(`cancel-${hold.id}`, () => api.cancelHold(hold.id), {
      success: `${hold.member_name}’s hold on “${book.title}” was cancelled.`,
      failure: 'Couldn’t cancel the hold',
    })
  }

  const copyDetail = (copy) => {
    if (copy.status === 'on_loan') {
      const loan = activeByCopy.get(copy.id)
      const due = loan ? dueInfo(loan) : null
      return (
        <>
          {loan ? (
            <a className="link-quiet" href={hrefFor('members', { member: loan.member_id })}>
              {loan.member_name}
            </a>
          ) : (
            'On loan'
          )}
          {' · '}
          <span className={due && due.tone === 'red' ? 'tone-text-red' : ''}>
            {due && due.tone === 'red' ? due.text : `due ${formatShort(copy.due_at)}`}
          </span>
        </>
      )
    }
    if (copy.status === 'on_hold_shelf') return copy.reserved_for ? <>Reserved for {copy.reserved_for}</> : 'Reserved'
    if (copy.status === 'lost') return 'Reported lost'
    if (copy.status === 'withdrawn') return 'Out of circulation'
    return 'Ready to lend'
  }

  return (
    <Drawer
      eyebrow={
        <>
          <span>{book.genre}</span>
          {book.published_year ? <span> · {book.published_year}</span> : null}
        </>
      }
      title={book.title}
      subtitle={
        <>
          <span>by {book.author}</span>
          <span className="drawer-meta mono">ISBN {book.isbn}</span>
        </>
      }
      onClose={onClose}
      actions={
        <>
          {canLend ? (
            <Button variant="primary" icon="arrowOut" onClick={() => openLend({ bookId: book.id })}>
              Lend
            </Button>
          ) : null}
          {canHold ? (
            <Button variant="primary" icon="bookmarkPlus" onClick={() => openHold({ bookId: book.id })}>
              Place hold
            </Button>
          ) : null}
          <Button icon="copies" onClick={() => setCopyForm({})}>
            Add copy
          </Button>
          <Button icon="pencil" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button variant="danger" icon="trash" busy={busy === 'delete'} onClick={deleteBook}>
            Delete
          </Button>
        </>
      }
    >
      <div className="statstrip">
        <div className="stat">
          <span className="stat-label">On shelf</span>
          <span className="stat-value">
            {book.copies_available}
            <span className="stat-of"> / {circulating}</span>
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">On loan</span>
          <span className="stat-value">{book.copies_on_loan}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Hold shelf</span>
          <span className="stat-value">{shelfCount}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Waiting</span>
          <span className="stat-value">{book.holds_waiting}</span>
        </div>
      </div>

      {circulating === 0 ? (
        <div className="notice tone-grey">
          <Icon name="info" size={16} />
          <span>No copy is in circulation. Add a copy to start lending this title.</span>
        </div>
      ) : canHold ? (
        <div className="notice tone-amber">
          <Icon name="bookmarkPlus" size={16} />
          <span>
            Every copy is out. Members can join the queue; a returned copy waits on the hold shelf for{' '}
            {plural(policy.hold_pickup_days, 'day')} for the first in line.
          </span>
        </div>
      ) : null}

      <DrawerSection title="Copies" count={book.copies.length} action={<Availability book={book} />}>
        {book.copies.length === 0 ? (
          <EmptyState compact icon="copies" title="No copies yet" action={<Button size="sm" icon="copies" onClick={() => setCopyForm({})}>Add a copy</Button>}>
            Copies get barcodes like SW{String(book.id).padStart(4, '0')}-01.
          </EmptyState>
        ) : (
          <ul className="rowlist">
            {book.copies.map((copy) => (
              <li key={copy.id} className={`rowlist-item copy-row ${copy.status === 'withdrawn' ? 'is-muted' : ''}`}>
                <div className="copy-main">
                  <code className="barcode">{copy.barcode}</code>
                  <span className="cell-sub">
                    {capitalise(copy.condition)} · {copy.shelf ? `Shelf ${copy.shelf}` : 'No shelf set'}
                  </span>
                </div>
                <div className="copy-state">
                  <CopyStatus status={copy.status} />
                  <span className="cell-sub">{copyDetail(copy)}</span>
                </div>
                <div className="row-actions">
                  {copy.status !== 'withdrawn' ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="pencil"
                        aria-label={`Edit ${copy.barcode}`}
                        title="Edit condition or shelf"
                        onClick={() => setCopyForm({ copy })}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="archive"
                        className="btn-quiet-danger"
                        aria-label={`Withdraw ${copy.barcode}`}
                        title="Withdraw copy"
                        busy={busy === `withdraw-${copy.id}`}
                        onClick={() => withdraw(copy)}
                      />
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </DrawerSection>

      <DrawerSection title="Hold queue" count={book.queue.length}>
        {book.queue.length === 0 ? (
          <p className="section-empty">No one is waiting for this title.</p>
        ) : (
          <ul className="rowlist">
            {book.queue.map((hold) => {
              const pickup = pickupInfo(hold)
              return (
                <li key={hold.id} className="rowlist-item queue-row">
                  <span className={`queue-pos ${hold.status === 'ready' ? 'is-ready' : ''}`} aria-hidden="true">
                    {hold.status === 'ready' ? <Icon name="bell" size={14} /> : `#${hold.position}`}
                  </span>
                  <div className="queue-main">
                    <div>
                      <a className="cell-title link-quiet" href={hrefFor('members', { member: hold.member_id })}>
                        {hold.member_name}
                      </a>{' '}
                      <span className="cell-sub mono">{hold.card_number}</span>
                    </div>
                    <div className="cell-sub">
                      {hold.status === 'ready' ? (
                        <>
                          <span className="sr-only">Ready: </span>
                          {hold.copy_barcode} on the hold shelf until {formatDay(hold.expires_at)}
                          {pickup ? <span className={`tone-text-${pickup.tone}`}> · {pickup.text}</span> : null}
                        </>
                      ) : (
                        <>
                          <span className="sr-only">Position {hold.position}: </span>
                          Waiting since {formatShort(hold.placed_at)} ({plural(daysSince(hold.placed_at), 'day')})
                        </>
                      )}
                    </div>
                  </div>
                  <div className="row-actions">
                    {hold.status === 'ready' ? (
                      <Button
                        size="sm"
                        variant="primary"
                        icon="arrowOut"
                        busy={busy === `checkout-${hold.id}`}
                        onClick={() => checkout(hold)}
                      >
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

      <DrawerSection title="Recent loans" count={closed.length || null}>
        {loans.error && !loans.data ? (
          <ErrorState compact error={loans.error} onRetry={loans.reload} title="Could not load lending history" />
        ) : !loans.data ? (
          <SkeletonLines lines={3} />
        ) : closed.length === 0 ? (
          <p className="section-empty">No returned loans yet.</p>
        ) : (
          <ul className="rowlist">
            {closed.map((loan) => (
              <li key={loan.id} className="rowlist-item hist-row">
                <div className="hist-main">
                  <a className="cell-title link-quiet" href={hrefFor('members', { member: loan.member_id })}>
                    {loan.member_name}
                  </a>
                  <span className="cell-sub">
                    <span className="mono">{loan.barcode}</span> · {formatShort(loan.borrowed_at)} → {formatShort(loan.closed_at)}
                  </span>
                </div>
                <div className="hist-side">
                  <LoanStatus loan={loan} />
                  {loan.fine_amount ? (
                    <span className={`cell-sub ${loan.fine_paid ? '' : 'tone-text-red'}`}>
                      {formatMoney(loan.fine_amount)} {loan.fine_paid ? 'paid' : 'unpaid'}
                    </span>
                  ) : loan.days_overdue ? (
                    <span className="cell-sub">{plural(loan.days_overdue, 'day')} late</span>
                  ) : (
                    <span className="cell-sub">On time</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </DrawerSection>

      {editing ? <BookFormModal book={book} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} /> : null}
      {copyForm ? <CopyFormModal book={book} copy={copyForm.copy} onClose={() => setCopyForm(null)} /> : null}
    </Drawer>
  )
}
