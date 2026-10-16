import { useState } from 'react'
import { api } from '../api.js'
import Button from '../components/Button.jsx'
import DataTable from '../components/DataTable.jsx'
import Icon from '../components/Icon.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { EmptyState, ErrorState, SkeletonLines } from '../components/States.jsx'
import { useApp } from '../context.js'
import { daysSince, formatDay, formatShort, formatStamp, pickupInfo, plural } from '../format.js'
import { hrefFor, useResource } from '../hooks.js'
import { BookCell, MemberCell, Panel } from './shared.jsx'

export default function Holds() {
  const { version, run, confirm, openHold, policy } = useApp()
  const holds = useResource(() => api.holds({ status: 'open' }), [version], { interval: 30000 })
  const [busy, setBusy] = useState(null)

  const list = holds.data || []
  const ready = list
    .filter((h) => h.status === 'ready')
    .sort((a, b) => Date.parse(a.expires_at) - Date.parse(b.expires_at))
  const groups = []
  for (const hold of list.filter((h) => h.status === 'waiting')) {
    let group = groups.find((g) => g.bookId === hold.book_id)
    if (!group) {
      group = { bookId: hold.book_id, title: hold.book_title, holds: [] }
      groups.push(group)
    }
    group.holds.push(hold)
  }
  groups.forEach((g) => g.holds.sort((a, b) => a.position - b.position))
  const waitingCount = groups.reduce((sum, g) => sum + g.holds.length, 0)

  const act = async (key, fn, options) => {
    setBusy(key)
    try {
      return await run(fn, options)
    } finally {
      setBusy(null)
    }
  }

  const checkout = (hold) =>
    act(`checkout-${hold.id}`, () => api.lend({ member_id: hold.member_id, book_id: hold.book_id }), {
      success: (loan) => `${loan.barcode} checked out to ${loan.member_name}. Due ${formatDay(loan.due_at)}.`,
      failure: `Couldn’t check out to ${hold.member_name}`,
    })

  const cancel = async (hold) => {
    const ok = await confirm({
      title: `Cancel ${hold.member_name}’s hold?`,
      message:
        hold.status === 'ready'
          ? `The reserved copy ${hold.copy_barcode} of “${hold.book_title}” passes to the next member waiting, or goes back on the shelf.`
          : `${hold.member_name} leaves the queue for “${hold.book_title}” (position ${hold.position}).`,
      confirmLabel: 'Cancel hold',
      cancelLabel: 'Keep hold',
      icon: 'bookmarkX',
    })
    if (!ok) return
    await act(`cancel-${hold.id}`, () => api.cancelHold(hold.id), {
      success: `${hold.member_name}’s hold on “${hold.book_title}” was cancelled.`,
      failure: 'Couldn’t cancel the hold',
    })
  }

  const loading = !holds.data && holds.loading

  return (
    <div className="page">
      <PageHeader
        eyebrow="Circulation"
        title="Holds"
        sub={`A returned copy waits ${plural(policy.hold_pickup_days, 'day')} on the hold shelf for the first member in the queue, then passes to the next.`}
        actions={
          <Button variant="primary" icon="bookmarkPlus" onClick={() => openHold({})}>
            Place hold
          </Button>
        }
      />

      {holds.error && !holds.data ? (
        <section className="card">
          <ErrorState error={holds.error} onRetry={holds.reload} title="Could not load holds" />
        </section>
      ) : (
        <div className="stack-lg">
          <Panel title="Ready for pickup" icon={<Icon name="bell" size={15} />} tone="amber" count={holds.data ? ready.length : null}>
            <DataTable
              caption="Holds ready for pickup"
              rows={holds.data ? ready : undefined}
              loading={loading}
              skeletonRows={2}
              rowKey={(h) => h.id}
              empty={
                <EmptyState compact icon="bookmarkCheck" title="Nothing on the hold shelf">
                  When a held title comes back, its copy is set aside here for the member at the front of the queue.
                </EmptyState>
              }
              columns={[
                {
                  key: 'member',
                  header: 'Member',
                  primary: true,
                  render: (h) => <MemberCell id={h.member_id} name={h.member_name} card={h.card_number} />,
                },
                {
                  key: 'book',
                  header: 'Book',
                  render: (h) => <BookCell id={h.book_id} title={h.book_title} sub={h.copy_barcode} mono />,
                },
                {
                  key: 'since',
                  header: 'On hold shelf since',
                  className: 'hide-lg hide-md',
                  render: (h) => (
                    <span className="nowrap" title={formatStamp(h.ready_at)}>
                      {formatShort(h.ready_at)}
                    </span>
                  ),
                },
                {
                  key: 'until',
                  header: 'Pick up by',
                  render: (h) => {
                    const pickup = pickupInfo(h)
                    return (
                      <span className="stack">
                        <span className="nowrap" title={formatStamp(h.expires_at)}>
                          {formatDay(h.expires_at)}
                        </span>
                        {pickup ? <span className={`cell-sub tone-text-${pickup.tone}`}>{pickup.text}</span> : null}
                      </span>
                    )
                  },
                },
                {
                  key: 'actions',
                  header: <span className="sr-only">Actions</span>,
                  actions: true,
                  render: (h) => (
                    <div className="row-actions">
                      <Button
                        size="sm"
                        variant="primary"
                        icon="arrowOut"
                        busy={busy === `checkout-${h.id}`}
                        disabled={busy !== null}
                        onClick={() => checkout(h)}
                      >
                        Check out
                      </Button>
                      <Button size="sm" variant="ghost" busy={busy === `cancel-${h.id}`} disabled={busy !== null} onClick={() => cancel(h)}>
                        Cancel
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          </Panel>

          <Panel title="Waiting" icon={<Icon name="holds" size={15} />} count={holds.data ? waitingCount : null} bodyClass="queue-groups">
            {loading ? (
              <div className="card-body">
                <SkeletonLines lines={3} />
              </div>
            ) : groups.length === 0 ? (
              <EmptyState compact icon="holds" title="No one is waiting">
                Members join a queue when every copy of a title is out.
              </EmptyState>
            ) : (
              groups.map((group) => (
                <section key={group.bookId} className="queue-group" aria-label={`Queue for ${group.title}`}>
                  <header className="queue-group-head">
                    <a className="cell-title link-quiet" href={hrefFor('catalogue', { book: group.bookId })}>
                      {group.title}
                    </a>
                    <span className="cell-sub">{plural(group.holds.length, 'member')} waiting</span>
                  </header>
                  <ol className="rowlist">
                    {group.holds.map((h) => (
                      <li key={h.id} className="rowlist-item queue-row">
                        <span className="queue-pos" aria-hidden="true">
                          #{h.position}
                        </span>
                        <div className="queue-main">
                          <MemberCell id={h.member_id} name={h.member_name} card={h.card_number} size={26} />
                        </div>
                        <span className="cell-sub queue-since" title={formatStamp(h.placed_at)}>
                          <span className="sr-only">Position {h.position}, </span>
                          waiting since {formatShort(h.placed_at)} · {plural(daysSince(h.placed_at), 'day')}
                        </span>
                        <div className="row-actions">
                          <Button size="sm" variant="ghost" busy={busy === `cancel-${h.id}`} disabled={busy !== null} onClick={() => cancel(h)}>
                            Cancel
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              ))
            )}
          </Panel>
        </div>
      )}
    </div>
  )
}
