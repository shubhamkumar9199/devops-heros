import { useState } from 'react'
import { api } from '../api.js'
import Button from '../components/Button.jsx'
import Combobox from '../components/Combobox.jsx'
import { Field, FormAlert } from '../components/Field.jsx'
import Icon from '../components/Icon.jsx'
import Modal from '../components/Modal.jsx'
import { errorTitle } from '../components/Toasts.jsx'
import { useApp } from '../context.js'
import { formatDay, now, plural } from '../format.js'
import { useResource } from '../hooks.js'
import { bookKey, bookLabel, BookOption, matchBook, matchMember, memberKey, memberLabel, MemberNote, MemberOption } from './pickers.jsx'

const DAY_MS = 86400000

/** Check a copy out: searchable member + searchable book, refusals shown inline. */
export default function LendModal({ preset = {}, onClose }) {
  const { policy, toast, bump } = useApp()
  const members = useResource(() => api.members(), [])
  const books = useResource(() => api.books(), [])
  const [memberId, setMemberId] = useState(preset.memberId ?? null)
  const [bookId, setBookId] = useState(preset.bookId ?? null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)

  const member = (members.data || []).find((m) => m.id === memberId) || null
  const book = (books.data || []).find((b) => b.id === bookId) || null
  const rule = member ? policy.members[member.member_type] : null

  const refresh = () => {
    members.reload()
    books.reload()
  }

  const lend = async (event) => {
    event.preventDefault()
    if (!memberId || !bookId) {
      setError({ message: !memberId ? 'Choose the member who is borrowing.' : 'Choose the book to lend.', local: true })
      return
    }
    setBusy('lend')
    setError(null)
    try {
      const loan = await api.lend({ member_id: memberId, book_id: bookId })
      toast.success(
        `${loan.barcode} of “${loan.book_title}” lent to ${loan.member_name}. Due back ${formatDay(loan.due_at)}.`,
        'Book lent',
      )
      bump()
      onClose()
    } catch (err) {
      setError(err)
      if (err.status === 409 || err.status === 404) refresh()
    } finally {
      setBusy(null)
    }
  }

  const placeHold = async () => {
    setBusy('hold')
    try {
      const hold = await api.placeHold({ member_id: memberId, book_id: bookId })
      toast.success(`${hold.member_name} is #${hold.position} in the queue for “${hold.book_title}”.`, 'Hold placed')
      bump()
      onClose()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(null)
    }
  }

  const bookHint = book
    ? book.copies_available > 0
      ? `${plural(book.copies_available, 'copy', 'copies')} on the shelf; the desk picks one (or the member’s reserved copy).`
      : book.copies_total
        ? `No copy on the shelf${book.holds_waiting ? `, ${book.holds_waiting} waiting` : ''}. Only a member with a ready hold can borrow it now.`
        : 'No copy of this title is in circulation.'
    : 'Each title shows how many copies are on the shelf right now.'

  return (
    <Modal
      title="Lend a book"
      description="Check a copy out to a member. The server applies the lending rules."
      onClose={onClose}
      onSubmit={lend}
      busy={busy !== null}
      footer={
        <>
          <Button onClick={onClose} disabled={busy !== null}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="arrowOut" busy={busy === 'lend'} disabled={busy === 'hold'}>
            Lend book
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field id="lend-member" label="Member" error={members.error ? members.error.message : null}>
          <Combobox
            id="lend-member"
            items={members.data}
            loading={members.loading && !members.data}
            value={memberId}
            onChange={(value) => {
              setMemberId(value)
              setError(null)
            }}
            getKey={memberKey}
            getLabel={memberLabel}
            matches={matchMember}
            renderOption={(m) => <MemberOption member={m} policy={policy} />}
            placeholder="Search name, card number or email"
            emptyText="No active member matches"
            autoFocus={!preset.memberId}
          />
        </Field>
        {member ? <MemberNote member={member} policy={policy} /> : null}

        <Field id="lend-book" label="Book" hint={bookHint} error={books.error ? books.error.message : null}>
          <Combobox
            id="lend-book"
            items={books.data}
            loading={books.loading && !books.data}
            value={bookId}
            onChange={(value) => {
              setBookId(value)
              setError(null)
            }}
            getKey={bookKey}
            getLabel={bookLabel}
            matches={matchBook}
            renderOption={(b) => <BookOption book={b} />}
            placeholder="Search title, author or ISBN"
            emptyText="No title matches"
            describedBy="lend-book-hint"
            autoFocus={Boolean(preset.memberId) && !preset.bookId}
          />
        </Field>

        {member && rule ? (
          <p className="due-preview">
            <Icon name="calendar" size={16} />
            <span>
              Due back <strong>{formatDay(new Date(now() + rule.loan_days * DAY_MS))}</strong> · {rule.loan_days}-day{' '}
              {member.member_type} loan, renewable {plural(policy.max_renewals, 'time')}
            </span>
          </p>
        ) : null}

        {error ? (
          <FormAlert
            title={error.local ? 'Almost there' : error.status === 409 ? 'The desk can’t lend this' : errorTitle(error)}
            tone={error.local ? 'amber' : 'red'}
            action={
              error.code === 'no_copy_available' ? (
                <Button size="sm" icon="bookmarkPlus" busy={busy === 'hold'} disabled={busy === 'lend'} onClick={placeHold}>
                  Place a hold instead
                </Button>
              ) : null
            }
          >
            {error.message}
          </FormAlert>
        ) : null}
      </div>
    </Modal>
  )
}
