import { useState } from 'react'
import { api } from '../api.js'
import ActivityFeed from '../components/ActivityFeed.jsx'
import Button from '../components/Button.jsx'
import CirculationBar from '../components/CirculationBar.jsx'
import DataTable from '../components/DataTable.jsx'
import Icon from '../components/Icon.jsx'
import KpiCard from '../components/KpiCard.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { EmptyState, ErrorState, SkeletonLines } from '../components/States.jsx'
import { Pill } from '../components/StatusPill.jsx'
import { useApp } from '../context.js'
import {
  formatDay,
  formatLongDay,
  formatMoney,
  formatNumber,
  formatShort,
  greeting,
  now,
  pickupInfo,
  plural,
} from '../format.js'
import { useResource, useTicker } from '../hooks.js'
import { useLoanActions } from './loanActions.jsx'
import { BookCell, MemberCell, Panel } from './shared.jsx'

const REFRESH_MS = 15000

export default function Dashboard() {
  const { stats, reloadStats, version, openLend, policy, run, online } = useApp()
  const overdue = useResource(() => api.loans({ status: 'overdue' }), [version], { interval: REFRESH_MS })
  const ready = useResource(() => api.holds({ status: 'ready' }), [version], { interval: REFRESH_MS })
  const activity = useResource(() => api.activity(20), [version], { interval: REFRESH_MS })
  const members = useResource(() => api.members(), [version], { interval: REFRESH_MS })
  const loanActions = useLoanActions()
  const [checkingOut, setCheckingOut] = useState(null)
  useTicker(REFRESH_MS)

  const refreshing = overdue.loading || ready.loading || activity.loading
  const reloadAll = () => {
    reloadStats()
    overdue.reload()
    ready.reload()
    activity.reload()
    members.reload()
  }

  const s = stats
  const accruing = (overdue.data || []).reduce((sum, loan) => sum + loan.fine_amount, 0)
  const blocked = (members.data || []).filter((m) => !m.can_borrow).length

  const checkout = async (hold) => {
    setCheckingOut(hold.id)
    await run(() => api.lend({ member_id: hold.member_id, book_id: hold.book_id }), {
      success: (loan) => `${loan.barcode} checked out to ${loan.member_name}. Due ${formatDay(loan.due_at)}.`,
      failure: `Couldn’t check out to ${hold.member_name}`,
    })
    setCheckingOut(null)
  }

  const today = s
    ? `${plural(s.loans_today, 'loan')} and ${plural(s.returns_today, 'return')} so far today`
    : 'Loading today’s numbers…'

  return (
    <div className="page">
      <PageHeader
        eyebrow={`Main library · ${formatLongDay(now())}`}
        title={greeting()}
        sub={
          <>
            {today}
            {s && s.loans_overdue ? (
              <>
                {' · '}
                <a className="link-danger" href="#/loans?tab=overdue">
                  {plural(s.loans_overdue, 'loan')} overdue
                </a>
              </>
            ) : null}
          </>
        }
        actions={
          <>
            <span
              className={`live ${online ? '' : 'is-offline'}`}
              title={online ? `Refreshes every ${REFRESH_MS / 1000} seconds` : 'Reconnecting to the server'}
            >
              <span className={`live-dot ${refreshing ? 'is-busy' : ''}`} aria-hidden="true" />
              {online ? 'Live' : 'Offline'}
            </span>
            <Button icon="refresh" aria-label="Refresh dashboard" title="Refresh now" onClick={reloadAll} />
            <Button variant="primary" icon="plus" onClick={() => openLend({})}>
              Lend a book
            </Button>
          </>
        }
      />

      <section className="kpis" aria-label="Today at a glance">
        <KpiCard
          label="On loan"
          icon="arrowOut"
          tone="blue"
          loading={!s}
          value={s && formatNumber(s.loans_active)}
          sub={s && `${s.loans_today} lent · ${s.returns_today} returned today`}
          href="#/loans?tab=active"
        />
        <KpiCard
          label="Overdue"
          icon="clock"
          tone={s && s.loans_overdue ? 'red' : 'green'}
          alert={Boolean(s && s.loans_overdue)}
          loading={!s}
          value={s && formatNumber(s.loans_overdue)}
          sub={s && (s.loans_overdue ? `${formatMoney(accruing)} in late fines so far` : 'Every loan is on time')}
          href="#/loans?tab=overdue"
        />
        <KpiCard
          label="Holds ready"
          icon="bell"
          tone="amber"
          alert={Boolean(s && s.holds_ready)}
          loading={!s}
          value={s && formatNumber(s.holds_ready)}
          sub={s && `${s.holds_waiting} waiting in queues`}
          href="#/holds"
        />
        <KpiCard
          label="Unpaid fines"
          icon="rupee"
          tone={s && s.fines_outstanding ? 'red' : 'green'}
          loading={!s}
          value={s && formatMoney(s.fines_outstanding)}
          sub={policy && `Blocks loans at ${formatMoney(policy.fine_block_at)}`}
          href="#/loans?tab=unpaid"
        />
        <KpiCard
          label="Copies on shelf"
          icon="books"
          tone="green"
          loading={!s}
          value={
            s && (
              <>
                {formatNumber(s.copies_by_status.available)}
                <span className="kpi-of"> / {formatNumber(s.copies)}</span>
              </>
            )
          }
          sub={s && `${plural(s.books, 'title')} catalogued`}
          href="#/catalogue"
        />
        <KpiCard
          label="Active members"
          icon="users"
          tone="accent"
          loading={!s}
          value={s && formatNumber(s.members_active)}
          sub={members.data ? (blocked ? `${blocked} can’t borrow now` : 'All in good standing') : ' '}
          href="#/members"
        />
      </section>

      <div className="dash-grid">
        <div className="dash-col">
          <Panel
            title="Overdue"
            icon={<Icon name="clock" size={15} />}
            tone="red"
            count={overdue.data ? overdue.data.length : null}
            action={
              <a className="card-link" href="#/loans?tab=overdue">
                All loans <Icon name="arrowRight" size={14} />
              </a>
            }
          >
            {overdue.error && !overdue.data ? (
              <ErrorState error={overdue.error} onRetry={overdue.reload} compact title="Could not load overdue loans" />
            ) : (
              <DataTable
                dense
                compactActions
                caption="Overdue loans"
                rows={overdue.data}
                loading={overdue.loading}
                skeletonRows={3}
                rowKey={(loan) => loan.id}
                empty={
                  <EmptyState compact icon="checkCircle" tone="green" title="Nothing overdue">
                    Every loan is inside its due date.
                  </EmptyState>
                }
                columns={[
                  {
                    key: 'member',
                    header: 'Member',
                    primary: true,
                    render: (loan) => <MemberCell id={loan.member_id} name={loan.member_name} card={loan.card_number} />,
                  },
                  {
                    key: 'book',
                    header: 'Book',
                    render: (loan) => <BookCell id={loan.book_id} title={loan.book_title} sub={loan.barcode} mono />,
                  },
                  {
                    key: 'late',
                    header: 'Late',
                    render: (loan) => (
                      <span className="stack">
                        <Pill tone="red">{plural(loan.days_overdue, 'day')} late</Pill>
                        <span className="cell-sub">due {formatShort(loan.due_at)}</span>
                      </span>
                    ),
                  },
                  {
                    key: 'fine',
                    header: 'Fine so far',
                    align: 'right',
                    render: (loan) => <span className="money tone-text-red">{formatMoney(loan.fine_amount)}</span>,
                  },
                  {
                    key: 'actions',
                    header: <span className="sr-only">Actions</span>,
                    actions: true,
                    render: (loan) => (
                      <Button
                        size="sm"
                        variant="primary"
                        icon="arrowIn"
                        busy={loanActions.busy === `return-${loan.id}`}
                        disabled={loanActions.busy !== null}
                        onClick={() => loanActions.returnLoan(loan)}
                      >
                        Return
                      </Button>
                    ),
                  },
                ]}
              />
            )}
          </Panel>

          <Panel
            title="Ready for pickup"
            icon={<Icon name="bell" size={15} />}
            tone="amber"
            count={ready.data ? ready.data.length : null}
            action={
              <a className="card-link" href="#/holds">
                All holds <Icon name="arrowRight" size={14} />
              </a>
            }
          >
            {ready.error && !ready.data ? (
              <ErrorState error={ready.error} onRetry={ready.reload} compact title="Could not load holds" />
            ) : (
              <DataTable
                dense
                compactActions
                caption="Holds ready for pickup"
                rows={ready.data}
                loading={ready.loading}
                skeletonRows={2}
                rowKey={(hold) => hold.id}
                empty={
                  <EmptyState compact icon="bookmarkCheck" title="Hold shelf is empty">
                    Returned copies with a queue land here for {policy ? plural(policy.hold_pickup_days, 'day') : 'a few days'}.
                  </EmptyState>
                }
                columns={[
                  {
                    key: 'member',
                    header: 'Member',
                    primary: true,
                    render: (hold) => <MemberCell id={hold.member_id} name={hold.member_name} card={hold.card_number} />,
                  },
                  {
                    key: 'book',
                    header: 'Book',
                    render: (hold) => <BookCell id={hold.book_id} title={hold.book_title} sub={hold.copy_barcode} mono />,
                  },
                  {
                    key: 'until',
                    header: 'Pick up by',
                    render: (hold) => {
                      const pickup = pickupInfo(hold)
                      return (
                        <span className="stack">
                          <span className="nowrap">{formatDay(hold.expires_at)}</span>
                          {pickup ? <span className={`cell-sub tone-text-${pickup.tone}`}>{pickup.text}</span> : null}
                        </span>
                      )
                    },
                  },
                  {
                    key: 'actions',
                    header: <span className="sr-only">Actions</span>,
                    actions: true,
                    render: (hold) => (
                      <Button
                        size="sm"
                        variant="primary"
                        icon="arrowOut"
                        busy={checkingOut === hold.id}
                        disabled={checkingOut !== null}
                        onClick={() => checkout(hold)}
                      >
                        Check out
                      </Button>
                    ),
                  },
                ]}
              />
            )}
          </Panel>

          <Panel
            title="Circulation"
            icon={<Icon name="gauge" size={15} />}
            action={s ? <span className="card-note">{plural(s.copies, 'copy', 'copies')} in circulation</span> : null}
            bodyClass="card-body"
          >
            {s ? <CirculationBar byStatus={s.copies_by_status} /> : <SkeletonLines lines={2} />}
          </Panel>
        </div>

        <div className="dash-col">
          <Panel
            title="Recent activity"
            icon={<Icon name="pulse" size={15} />}
            className="activity-panel"
            action={<span className="card-note">Latest {activity.data ? activity.data.length : 20}</span>}
          >
            {activity.error && !activity.data ? (
              <ErrorState error={activity.error} onRetry={activity.reload} compact title="Could not load activity" />
            ) : !activity.data ? (
              <div className="card-body">
                <SkeletonLines lines={8} />
              </div>
            ) : activity.data.length === 0 ? (
              <EmptyState compact icon="pulse" title="No activity yet">
                Loans, returns and new members will show up here.
              </EmptyState>
            ) : (
              <ActivityFeed items={activity.data} />
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
