import { useState } from 'react'
import { api } from '../api.js'
import Button from '../components/Button.jsx'
import DataTable from '../components/DataTable.jsx'
import { SearchInput, Switch } from '../components/Field.jsx'
import Icon from '../components/Icon.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { EmptyState, ErrorState } from '../components/States.jsx'
import { Availability } from '../components/StatusPill.jsx'
import { useApp } from '../context.js'
import { formatNumber, plural } from '../format.js'
import { closeDrawer, navigate, useDebounced, useResource } from '../hooks.js'
import BookDrawer from './BookDrawer.jsx'
import BookFormModal from './BookFormModal.jsx'

export default function Catalogue({ params }) {
  const { version, policy, stats } = useApp()
  const [q, setQ] = useState('')
  const [genre, setGenre] = useState('')
  const [onShelf, setOnShelf] = useState(false)
  const [adding, setAdding] = useState(false)
  const query = useDebounced(q.trim(), 250)

  const books = useResource(
    () => api.books({ q: query, genre, available: onShelf ? true : undefined }),
    [query, genre, onShelf, version],
  )
  const rows = books.data
  const filtered = Boolean(query || genre || onShelf)
  const bookId = params.book ? Number(params.book) : null

  const copies = rows ? rows.reduce((sum, b) => sum + b.copies_total, 0) : 0
  const onShelfCount = rows ? rows.reduce((sum, b) => sum + b.copies_available, 0) : 0
  const sub = stats
    ? `${plural(stats.books, 'title')} · ${plural(stats.copies, 'copy', 'copies')} in circulation · ${formatNumber(
        stats.copies_by_status.available,
      )} on the shelf`
    : 'Every title, its copies and who is waiting for it'

  const open = (book) => navigate('catalogue', { book: book.id }, { drawer: true })

  return (
    <div className="page">
      <PageHeader
        eyebrow="Collection"
        title="Catalogue"
        sub={sub}
        actions={
          <Button variant="primary" icon="bookPlus" onClick={() => setAdding(true)}>
            Add book
          </Button>
        }
      />

      <section className="card">
        <div className="toolbar" role="search">
          <SearchInput
            id="catalogue-search"
            value={q}
            onChange={setQ}
            label="Search the catalogue"
            placeholder="Search title, author or ISBN"
          />
          <label className="sr-only" htmlFor="catalogue-genre">
            Genre
          </label>
          <select
            id="catalogue-genre"
            className="select toolbar-select"
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
          >
            <option value="">All genres</option>
            {policy.genres.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <Switch id="catalogue-onshelf" checked={onShelf} onChange={setOnShelf} label="On shelf only" />
          <span className="toolbar-count" aria-live="polite">
            {rows
              ? filtered
                ? `${plural(rows.length, 'match', 'matches')} · ${onShelfCount} of ${copies} on shelf`
                : `${plural(rows.length, 'title')}`
              : ''}
          </span>
        </div>

        {books.error && !rows ? (
          <ErrorState error={books.error} onRetry={books.reload} title="Could not load the catalogue" />
        ) : (
          <DataTable
            caption="Books in the catalogue"
            rows={rows}
            loading={books.loading}
            refreshing={books.loading && Boolean(rows)}
            rowKey={(b) => b.id}
            onRowClick={open}
            rowLabel={(b) => `Open ${b.title}`}
            empty={
              filtered ? (
                <EmptyState
                  icon="search"
                  title="No books match"
                  action={
                    <Button
                      size="sm"
                      onClick={() => {
                        setQ('')
                        setGenre('')
                        setOnShelf(false)
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                >
                  Try another title, author or ISBN, or widen the filters.
                </EmptyState>
              ) : (
                <EmptyState
                  icon="books"
                  title="The catalogue is empty"
                  action={
                    <Button size="sm" variant="primary" icon="bookPlus" onClick={() => setAdding(true)}>
                      Add the first book
                    </Button>
                  }
                >
                  Add a title with its copies to start lending.
                </EmptyState>
              )
            }
            columns={[
              {
                key: 'title',
                header: 'Title',
                primary: true,
                render: (b) => (
                  <span className="bookcell">
                    <span className="cell-title">{b.title}</span>
                    <span className="cell-sub">{b.author}</span>
                  </span>
                ),
              },
              { key: 'genre', header: 'Genre', render: (b) => <span className="genre">{b.genre}</span> },
              {
                key: 'year',
                header: 'Year',
                align: 'right',
                className: 'hide-md',
                render: (b) => <span className="tabular">{b.published_year || '—'}</span>,
              },
              {
                key: 'isbn',
                header: 'ISBN',
                className: 'hide-lg hide-md',
                render: (b) => <span className="mono cell-muted">{b.isbn}</span>,
              },
              { key: 'availability', header: 'Availability', render: (b) => <Availability book={b} /> },
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
        <BookFormModal
          onClose={() => setAdding(false)}
          onSaved={(book) => {
            setAdding(false)
            navigate('catalogue', { book: book.id }, { drawer: true })
          }}
        />
      ) : null}
      {bookId ? <BookDrawer key={bookId} id={bookId} onClose={() => closeDrawer('catalogue')} /> : null}
    </div>
  )
}
