import { useState } from 'react'
import { api } from '../api.js'
import Avatar from '../components/Avatar.jsx'
import Button from '../components/Button.jsx'
import DataTable from '../components/DataTable.jsx'
import { SearchInput, Switch } from '../components/Field.jsx'
import Icon from '../components/Icon.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { EmptyState, ErrorState } from '../components/States.jsx'
import { Fine, MemberStatus, shortReason, TypeBadge } from '../components/StatusPill.jsx'
import { useApp } from '../context.js'
import { plural } from '../format.js'
import { closeDrawer, navigate, useDebounced, useResource } from '../hooks.js'
import MemberDrawer from './MemberDrawer.jsx'
import MemberFormModal from './MemberFormModal.jsx'

export default function Members({ params }) {
  const { version, policy } = useApp()
  const [q, setQ] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [adding, setAdding] = useState(false)
  const query = useDebounced(q.trim(), 250)
  const members = useResource(
    () => api.members({ q: query, include_inactive: showClosed || undefined }),
    [query, showClosed, version],
  )
  const rows = members.data
  const memberId = params.member ? Number(params.member) : null

  const blocked = rows ? rows.filter((m) => m.is_active && !m.can_borrow).length : 0
  const students = rows ? rows.filter((m) => m.member_type === 'student' && m.is_active).length : 0
  const faculty = rows ? rows.filter((m) => m.member_type === 'faculty' && m.is_active).length : 0
  const rules = Object.entries(policy.members)
    .map(([type, rule]) => `${type}s ${rule.max_loans} loans / ${rule.loan_days} days`)
    .join(' · ')

  const open = (member) => navigate('members', { member: member.id }, { drawer: true })

  return (
    <div className="page">
      <PageHeader
        eyebrow="People"
        title="Members"
        sub={
          rows && !query
            ? `${plural(students, 'student')} and ${faculty} faculty · ${blocked ? `${blocked} can’t borrow right now` : 'all in good standing'}`
            : `Library cards for students and faculty · ${rules}`
        }
        actions={
          <Button variant="primary" icon="userPlus" onClick={() => setAdding(true)}>
            Add member
          </Button>
        }
      />

      <section className="card">
        <div className="toolbar" role="search">
          <SearchInput
            id="member-search"
            value={q}
            onChange={setQ}
            label="Search members"
            placeholder="Search name or email"
          />
          <Switch id="member-closed" checked={showClosed} onChange={setShowClosed} label="Show closed memberships" />
          <span className="toolbar-count" aria-live="polite">
            {rows ? plural(rows.length, 'member') : ''}
          </span>
        </div>

        {members.error && !rows ? (
          <ErrorState error={members.error} onRetry={members.reload} title="Could not load members" />
        ) : (
          <DataTable
            caption="Library members"
            rows={rows}
            loading={members.loading}
            refreshing={members.loading && Boolean(rows)}
            rowKey={(m) => m.id}
            onRowClick={open}
            rowLabel={(m) => `Open ${m.name}`}
            rowClassName={(m) => (m.is_active ? '' : 'row-muted')}
            empty={
              query ? (
                <EmptyState icon="search" title="No members match" action={<Button size="sm" onClick={() => setQ('')}>Clear search</Button>}>
                  Try part of a name or an email address.
                </EmptyState>
              ) : (
                <EmptyState
                  icon="users"
                  title="No members yet"
                  action={
                    <Button size="sm" variant="primary" icon="userPlus" onClick={() => setAdding(true)}>
                      Add the first member
                    </Button>
                  }
                >
                  Members need a library card before they can borrow.
                </EmptyState>
              )
            }
            columns={[
              {
                key: 'name',
                header: 'Member',
                primary: true,
                render: (m) => (
                  <span className="person">
                    <Avatar name={m.name} size={32} />
                    <span className="person-text">
                      <span className="cell-title">{m.name}</span>
                      <span className="cell-sub">{m.email}</span>
                    </span>
                  </span>
                ),
              },
              { key: 'card', header: 'Card', render: (m) => <span className="mono">{m.card_number}</span> },
              { key: 'type', header: 'Type', render: (m) => <TypeBadge type={m.member_type} /> },
              {
                key: 'loans',
                header: 'Loans',
                render: (m) => (
                  <span className="stack">
                    <span className="tabular">
                      <strong>{m.loans_active}</strong>
                      <span className="muted"> / {m.max_loans}</span>
                    </span>
                    {m.loans_overdue ? <span className="cell-sub tone-text-red">{m.loans_overdue} overdue</span> : null}
                  </span>
                ),
              },
              {
                key: 'fines',
                header: 'Fines',
                align: 'right',
                render: (m) => <Fine amount={m.fines_outstanding} blockAt={policy.fine_block_at} />,
              },
              {
                key: 'status',
                header: 'Status',
                className: 'cell-status',
                render: (m) => (
                  <span className="stack">
                    <MemberStatus member={m} policy={policy} />
                    {m.is_active && m.blocked_reason ? (
                      <span className="cell-sub reason" title={m.blocked_reason}>
                        {shortReason(m)}
                      </span>
                    ) : null}
                  </span>
                ),
              },
              {
                key: 'go',
                header: <span className="sr-only">Open</span>,
                className: 'cell-chevron',
                render: () => <Icon name="chevronRight" size={16} />,
              },
            ]}
          />
        )}
      </section>

      {adding ? (
        <MemberFormModal
          onClose={() => setAdding(false)}
          onSaved={(member) => {
            setAdding(false)
            navigate('members', { member: member.id }, { drawer: true })
          }}
        />
      ) : null}
      {memberId ? <MemberDrawer key={memberId} id={memberId} onClose={() => closeDrawer('members')} /> : null}
    </div>
  )
}
