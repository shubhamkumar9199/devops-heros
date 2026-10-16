import { useState } from 'react'
import { api } from '../api.js'
import Button from '../components/Button.jsx'
import { describedBy, Field, FormAlert } from '../components/Field.jsx'
import Modal from '../components/Modal.jsx'
import { useApp } from '../context.js'
import { capitalise } from '../format.js'

/** Add a copy to a book, or change a copy's condition / shelf. */
export default function CopyFormModal({ book, copy, onClose }) {
  const { policy, toast, bump } = useApp()
  const editing = Boolean(copy)
  const [condition, setCondition] = useState(copy ? copy.condition : policy.copy_conditions.includes('good') ? 'good' : policy.copy_conditions[0])
  const [shelf, setShelf] = useState(copy && copy.shelf ? copy.shelf : '')
  const [errors, setErrors] = useState({})
  const [failure, setFailure] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setErrors({})
    setFailure(null)
    setBusy(true)
    const payload = { condition, shelf: shelf.trim() || null }
    try {
      if (editing) {
        const saved = await api.updateCopy(copy.id, payload)
        toast.success(`${saved.barcode} is now “${saved.condition}”${saved.shelf ? ` on shelf ${saved.shelf}` : ''}.`, 'Copy updated')
      } else {
        const saved = await api.addCopy(book.id, payload)
        toast.success(
          saved.status === 'on_hold_shelf'
            ? `${saved.barcode} went straight to the hold shelf for the first member in the queue.`
            : `${saved.barcode} of “${book.title}” is on the shelf.`,
          'Copy added',
        )
      }
      bump()
      onClose()
    } catch (err) {
      if (err.status === 422 && Object.keys(err.fields).length) setErrors(err.fields)
      else setFailure(err)
    } finally {
      setBusy(false)
    }
  }

  const shelfHint = 'Where it lives, e.g. T-3-B (up to 20 characters)'

  return (
    <Modal
      title={editing ? `Edit ${copy.barcode}` : 'Add a copy'}
      description={editing ? `A copy of “${book.title}”.` : `A new copy of “${book.title}” gets the next barcode.`}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy} icon={editing ? 'check' : 'copies'}>
            {editing ? 'Save copy' : 'Add copy'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        {failure ? <FormAlert title="Couldn’t save the copy">{failure.message}</FormAlert> : null}
        <Field id="copy-condition" label="Condition" error={errors.condition}>
          <select
            id="copy-condition"
            className="select"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            data-autofocus=""
            aria-describedby={describedBy('copy-condition', errors.condition)}
          >
            {policy.copy_conditions.map((c) => (
              <option key={c} value={c}>
                {capitalise(c)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="copy-shelf" label="Shelf" optional error={errors.shelf} hint={shelfHint}>
          <input
            id="copy-shelf"
            className="input mono"
            value={shelf}
            maxLength={20}
            onChange={(e) => setShelf(e.target.value)}
            placeholder="T-3-B"
            aria-invalid={Boolean(errors.shelf) || undefined}
            aria-describedby={describedBy('copy-shelf', errors.shelf, shelfHint)}
          />
        </Field>
      </div>
    </Modal>
  )
}
