import { useMemo, useState } from 'react'
import { api } from '../api.js'
import Button from '../components/Button.jsx'
import Combobox from '../components/Combobox.jsx'
import { Field, FormAlert } from '../components/Field.jsx'
import Modal from '../components/Modal.jsx'
import { errorTitle } from '../components/Toasts.jsx'
import { useApp } from '../context.js'
import { plural } from '../format.js'
import { useResource } from '../hooks.js'
import { bookKey, bookLabel, BookOption, matchBook, matchMember, memberKey, memberLabel, MemberNote, MemberOption } from './pickers.jsx'

/** Join a member to the queue for a title with every copy out. */
export default function HoldModal({ preset = {}, onClose }) {
  const { policy, toast, bump } = useApp()
  const members = useResource(() => api.members(), [])
  const books = useResource(() => api.books(), [])
  const [memberId, setMemberId] = useState(preset.memberId ?? null)
  const [bookId, setBookId] = useState(preset.bookId ?? null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  // Holds only make sense when no copy is on the shelf (the server says so too).
  const holdable = useMemo(
    () =>
      books.data
        ? books.data.filter((b) => (b.copies_available === 0 && b.copies_total > 0) || b.id === preset.bookId)
        : books.data,
    [books.data, preset.bookId],
  )
  const member = (members.data || []).find((m) => m.id === memberId) || null
  const book = (books.data || []).find((b) => b.id === bookId) || null

  const submit = async (event) => {
    event.preventDefault()
    if (!memberId || !bookId) {
      setError({ message: !memberId ? 'Choose the member who wants the book.' : 'Choose the title to hold.', local: true })
      return
    }
    setBusy(true)
    setError(null)
    try {
      const hold = await api.placeHold({ member_id: memberId, book_id: bookId })
      toast.success(`${hold.member_name} is #${hold.position} in the queue for “${hold.book_title}”.`, 'Hold placed')
      bump()
      onClose()
    } catch (err) {
      setError(err)
      if (err.status === 409) {
        members.reload()
        books.reload()
      }
    } finally {
      setBusy(false)
    }
  }

  const bookHint = book
    ? book.holds_waiting
      ? `${plural(book.holds_waiting, 'member')} already waiting; this member joins at the back.`
      : 'Nobody is waiting yet: this member will be first in line.'
    : 'Only titles with every copy out are listed.'

  return (
    <Modal
      title="Place a hold"
      description={`When a copy comes back it waits ${plural(policy.hold_pickup_days, 'day')} on the hold shelf for the first member in the queue.`}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="bookmarkPlus" busy={busy}>
            Place hold
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field id="hold-member" label="Member" error={members.error ? members.error.message : null}>
          <Combobox
            id="hold-member"
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

        <Field id="hold-book" label="Book" hint={bookHint} error={books.error ? books.error.message : null}>
          <Combobox
            id="hold-book"
            items={holdable}
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
            emptyText="Every matching title has a copy on the shelf"
            describedBy="hold-book-hint"
            autoFocus={Boolean(preset.memberId) && !preset.bookId}
          />
        </Field>

        {error ? (
          <FormAlert
            title={error.local ? 'Almost there' : error.status === 409 ? 'The desk can’t place this hold' : errorTitle(error)}
            tone={error.local ? 'amber' : 'red'}
          >
            {error.message}
          </FormAlert>
        ) : null}
      </div>
    </Modal>
  )
}
