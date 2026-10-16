import { useMemo, useState } from 'react'
import { api } from '../api.js'
import Button from '../components/Button.jsx'
import DataTable from '../components/DataTable.jsx'
import { SearchInput } from '../components/Field.jsx'
import PageHeader from '../components/PageHeader.jsx'
import Segmented from '../components/Segmented.jsx'
import { EmptyState, ErrorState } from '../components/States.jsx'
import { Pill } from '../components/StatusPill.jsx'
import { useApp } from '../context.js'
import { dueInfo, formatMoney, formatShort, formatStamp, plural } from '../format.js'
import { navigate, useResource } from '../hooks.js'
import { LoanActionButtons, useLoanActions } from './loanActions.jsx'
import { BookCell, MemberCell } from './shared.jsx'

const TABS = ['active', 'overdue', 'unpaid', 'returned', 'lost']

const EMPTY = {
  active: ['books', 'No books are out', 'Lend a book and it will appear here until it comes back.'],
  overdue: ['checkCircle', 'Nothing overdue', 'Every loan is inside its due date.'],
  unpaid: ['checkCircle', 'No unpaid fines', 'Late fines and lost-book fees that are still owed show up here.'],
  returned: ['inbox', 'No returns yet', 'Closed loans will be listed here, newest first.'],
  lost: ['checkCircle', 'No lost books', 'Copies reported lost are listed here with their replacement fee.'],
}

function DateCell({ value, sub, subTone }) {
  return (
    <span className="stack">
      <span className="nowrap" title={formatStamp(value)}>
        {formatShort(value)}
      </span>
      {sub ? <span className={`cell-sub ${subTone ? `tone-text-${subTone}` : ''}`}>{sub}</span> : null}
    </span>
  )
}

export default function Loans({ params }) {
  const { version, stats, openLend, policy } = useApp()
  const tab = TABS.includes(params.tab) ? params.tab : 'active'
  const [filter, setFilter] = useState('')
  // Tag the rows with their tab: a tab switch shows a skeleton, a refresh keeps the rows.
  const loans = useResource(async () => ({ tab, rows: await api.loans({ status: tab }) }), [tab, version], {
    interval: 30000,
  })
  const actions = useLoanActions()
  const current = loans.data && loans.data.tab === tab ? loans.data.rows : undefined

  const rows = useMemo(() => {
    if (!current) return current
    const q = filter.trim().toLowerCase()
    if (!q) return current
    return current.filter((l) =>
      [l.book_title, l.member_name, l.card_number, l.barcode].some((v) => v.toLowerCase().includes(q)),
    )
  }, [current, filter])

  const options = [
    { value: 'active', label: 'Active', count: stats ? stats.loans_active : null },
    { value: 'overdue', label: 'Overdue', count: stats ? stats.loans_overdue : null, tone: stats && stats.loans_overdue ? 'red' : null },
    { value: 'unpaid', label: 'Unpaid fines', count: tab === 'unpaid' && current ? current.length : null },
    { value: 'returned', label: 'Returned' },
    { value: 'lost', label: 'Lost' },
  ]

  const member = {
    key: 'member',
    header: 'Member',
    render: (l) => <MemberCell id={l.member_id} name={l.member_name} card={l.card_number} />,
  }
  const book = {
    key: 'book',
    header: 'Book',
    primary: true,
    render: (l) => <BookCell id={l.book_id} title={l.book_title} sub={l.barcode} mono />,
  }
  const borrowed = { key: 'borrowed', header: 'Borrowed', className: 'hide-lg hide-md', render: (l) => <DateCell value={l.borrowed_at} /> }
  const actionsCol = {
    key: 'actions',
    header: <span className="sr-only">Actions</span>,
    actions: true,
    render: (l) => <LoanActionButtons loan={l} actions={actions} />,
  }

  let columns
  if (tab === 'active' || tab === 'overdue') {
    columns = [
      book,
      member,
      borrowed,
      {
        key: 'due',
        header: 'Due',
        render: (l) => {
          const due = dueInfo(l)
          return <DateCell value={l.due_at} sub={due ? due.text : null} subTone={due && due.tone !== 'muted' ? due.tone : null} />
        },
      },
      {
        key: 'renewals',
        header: 'Renewals',
        className: 'hide-lg',
        render: (l) => (
          <span className="tabular" title={`${l.renewals} of ${policy.max_renewals} used`}>
            {l.renewals_left} left
          </span>
        ),
      },
      {
        key: 'fine',
        header: 'Fine so far',
        align: 'right',
        render: (l) =>
          l.fine_amount ? <span className="money tone-text-red">{formatMoney(l.fine_amount)}</span> : <span className="muted">—</span>,
      },
      actionsCol,
    ]
  } else if (tab === 'unpaid') {
    columns = [
      book,
      member,
      {
        key: 'closed',
        header: 'Closed',
        render: (l) => <DateCell value={l.closed_at} sub={l.status === 'lost' ? 'Reported lost' : 'Returned'} />,
      },
      {
        key: 'reason',
        header: 'Reason',
        render: (l) =>
          l.status === 'lost' ? (
            <Pill tone="red">Replacement fee</Pill>
          ) : (
            <Pill tone="amber">{plural(l.days_overdue, 'day')} late</Pill>
          ),
      },
      {
        key: 'fine',
        header: 'Owed',
        align: 'right',
        render: (l) => <span className="money tone-text-red">{formatMoney(l.fine_amount)}</span>,
      },
      actionsCol,
    ]
  } else if (tab === 'returned') {
    columns = [
      book,
      member,
      borrowed,
      { key: 'returned', header: 'Returned', render: (l) => <DateCell value={l.closed_at} /> },
      {
        key: 'late',
        header: 'Late',
        render: (l) =>
          l.days_overdue ? <Pill tone="amber">{plural(l.days_overdue, 'day')}</Pill> : <span className="muted">On time</span>,
      },
      {
        key: 'fine',
        header: 'Fine',
        align: 'right',
        render: (l) =>
          l.fine_amount ? (
            <span className="stack stack-end">
              <span className="money">{formatMoney(l.fine_amount)}</span>
              <span className={`cell-sub ${l.fine_paid ? 'tone-text-green' : 'tone-text-red'}`}>{l.fine_paid ? 'Paid' : 'Unpaid'}</span>
            </span>
          ) : (
            <span className="muted">—</span>
          ),
      },
      actionsCol,
    ]
  } else {
    columns = [
      book,
      member,
      borrowed,
      { key: 'reported', header: 'Reported lost', render: (l) => <DateCell value={l.closed_at} /> },
      {
        key: 'fee',
        header: 'Fee',
        align: 'right',
        render: (l) => (
          <span className="stack stack-end">
            <span className="money">{formatMoney(l.fine_amount)}</span>
            <span className={`cell-sub ${l.fine_paid ? 'tone-text-green' : 'tone-text-red'}`}>{l.fine_paid ? 'Paid' : 'Unpaid'}</span>
          </span>
        ),
      },
      actionsCol,
    ]
  }

  const [icon, emptyTitle, emptyText] = EMPTY[tab]
  const ruleLine = `${policy.members.student.loan_days} days for students, ${policy.members.faculty.loan_days} for faculty · ${formatMoney(policy.fine_per_day)} a day late, capped at ${formatMoney(policy.fine_cap)} · ${policy.max_renewals} renewals`

  return (
    <div className="page">
      <PageHeader
        eyebrow="Circulation"
        title="Loans"
        sub={ruleLine}
        actions={
          <Button variant="primary" icon="plus" onClick={() => openLend({})}>
            Lend a book
          </Button>
        }
      />

      <section className="card">
        <div className="toolbar toolbar-tabs">
          <Segmented
            id="loans"
            label="Loan status"
            options={options}
            value={tab}
            onChange={(value) => navigate('loans', { tab: value }, { replace: true })}
          />
          <SearchInput
            id="loan-filter"
            value={filter}
            onChange={setFilter}
            label="Filter loans"
            placeholder="Filter by book, member or barcode"
          />
        </div>
        <div id="loans-panel" role="tabpanel" aria-labelledby={`loans-tab-${tab}`}>
          {loans.error && !current ? (
            <ErrorState error={loans.error} onRetry={loans.reload} title="Could not load loans" />
          ) : (
            <DataTable
              caption={`${tab} loans`}
              rows={rows}
              loading={loans.loading || !current}
              refreshing={loans.loading && Boolean(current)}
              rowKey={(l) => l.id}
              rowClassName={(l) => (l.is_overdue ? 'row-overdue' : '')}
              empty={
                filter.trim() && current && current.length ? (
                  <EmptyState icon="search" title="No loans match" action={<Button size="sm" onClick={() => setFilter('')}>Clear filter</Button>}>
                    Nothing in this list matches “{filter.trim()}”.
                  </EmptyState>
                ) : (
                  <EmptyState icon={icon} tone={icon === 'checkCircle' ? 'green' : undefined} title={emptyTitle}>
                    {emptyText}
                  </EmptyState>
                )
              }
              columns={columns}
            />
          )}
        </div>
      </section>
    </div>
  )
}
