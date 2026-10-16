import { useState } from 'react'
import { api } from '../api.js'
import Button from '../components/Button.jsx'
import { describedBy, Field, FormAlert } from '../components/Field.jsx'
import Modal from '../components/Modal.jsx'
import { useApp } from '../context.js'

/** Add a book (with N copies) or edit one. PUT replaces every field. */
export default function BookFormModal({ book, onClose, onSaved }) {
  const { policy, toast, bump } = useApp()
  const editing = Boolean(book)
  const [form, setForm] = useState(() => ({
    isbn: book ? book.isbn : '',
    title: book ? book.title : '',
    author: book ? book.author : '',
    genre: book ? book.genre : policy.genres[0],
    published_year: book && book.published_year ? String(book.published_year) : '',
    copies: '1',
  }))
  const [errors, setErrors] = useState({})
  const [failure, setFailure] = useState(null)
  const [busy, setBusy] = useState(false)

  const genres = policy.genres.includes(form.genre) ? policy.genres : [form.genre, ...policy.genres]
  const set = (key) => (event) => {
    const value = event.target.value
    setForm((f) => ({ ...f, [key]: value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const validate = () => {
    const next = {}
    if (!form.isbn.trim()) next.isbn = 'Enter the ISBN from the back cover'
    if (!form.title.trim()) next.title = 'Enter the title'
    if (!form.author.trim()) next.author = 'Enter the author'
    if (form.published_year.trim() && !/^\d{1,4}$/.test(form.published_year.trim())) {
      next.published_year = 'Enter a year such as 2017'
    }
    if (!editing && !/^\d{1,2}$/.test(form.copies.trim())) next.copies = 'Enter a number of copies'
    return next
  }

  const submit = async (event) => {
    event.preventDefault()
    const local = validate()
    setErrors(local)
    setFailure(null)
    if (Object.keys(local).length) return
    const payload = {
      isbn: form.isbn.trim(),
      title: form.title.trim(),
      author: form.author.trim(),
      genre: form.genre,
      published_year: form.published_year.trim() ? Number(form.published_year.trim()) : null,
    }
    if (!editing) payload.copies = Number(form.copies.trim())
    setBusy(true)
    try {
      const saved = editing ? await api.updateBook(book.id, payload) : await api.createBook(payload)
      toast.success(
        editing
          ? `“${saved.title}” was updated.`
          : `“${saved.title}” added with ${saved.copies.length} ${saved.copies.length === 1 ? 'copy' : 'copies'}.`,
        editing ? 'Book saved' : 'Book added',
      )
      bump()
      if (onSaved) onSaved(saved)
      else onClose()
    } catch (err) {
      if (err.status === 422 && Object.keys(err.fields).length) {
        setErrors(err.fields)
      } else if (err.code === 'isbn_exists') {
        setErrors({ isbn: err.message })
      } else {
        setFailure(err)
      }
    } finally {
      setBusy(false)
    }
  }

  const ids = {
    isbn: 'book-isbn',
    title: 'book-title',
    author: 'book-author',
    genre: 'book-genre',
    published_year: 'book-year',
    copies: 'book-copies',
  }
  const hints = {
    isbn: 'ISBN-10 or ISBN-13; hyphens are fine. The server checks the check digit.',
    published_year: 'Between 1450 and 2100',
    copies: 'Up to 20 copies, all placed on the shelf',
  }

  return (
    <Modal
      title={editing ? 'Edit book' : 'Add a book'}
      description={editing ? `Changes replace the catalogue record for “${book.title}”.` : 'Add a title to the catalogue and put its copies on the shelf.'}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy} icon={editing ? 'check' : 'bookPlus'}>
            {editing ? 'Save changes' : 'Add book'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        {failure ? (
          <FormAlert title={editing ? 'Couldn’t save the book' : 'Couldn’t add the book'}>{failure.message}</FormAlert>
        ) : null}
        <div className="form-row">
          <Field id={ids.isbn} label="ISBN" error={errors.isbn} hint={hints.isbn} className="grow">
            <input
              id={ids.isbn}
              className="input mono"
              value={form.isbn}
              onChange={set('isbn')}
              inputMode="text"
              autoComplete="off"
              spellCheck="false"
              placeholder="978-0-13-235088-4"
              aria-invalid={Boolean(errors.isbn) || undefined}
              aria-describedby={describedBy(ids.isbn, errors.isbn, hints.isbn)}
              data-autofocus=""
            />
          </Field>
        </div>
        <Field id={ids.title} label="Title" error={errors.title}>
          <input
            id={ids.title}
            className="input"
            value={form.title}
            onChange={set('title')}
            maxLength={200}
            aria-invalid={Boolean(errors.title) || undefined}
            aria-describedby={describedBy(ids.title, errors.title)}
          />
        </Field>
        <Field id={ids.author} label="Author" error={errors.author}>
          <input
            id={ids.author}
            className="input"
            value={form.author}
            onChange={set('author')}
            maxLength={120}
            aria-invalid={Boolean(errors.author) || undefined}
            aria-describedby={describedBy(ids.author, errors.author)}
          />
        </Field>
        <div className="form-row">
          <Field id={ids.genre} label="Genre" error={errors.genre} className="grow">
            <select
              id={ids.genre}
              className="select"
              value={form.genre}
              onChange={set('genre')}
              aria-invalid={Boolean(errors.genre) || undefined}
              aria-describedby={describedBy(ids.genre, errors.genre)}
            >
              {genres.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
          <Field id={ids.published_year} label="Year" optional error={errors.published_year} className="w-year">
            <input
              id={ids.published_year}
              className="input tabular"
              value={form.published_year}
              onChange={set('published_year')}
              inputMode="numeric"
              placeholder="2017"
              aria-invalid={Boolean(errors.published_year) || undefined}
              aria-describedby={describedBy(ids.published_year, errors.published_year)}
            />
          </Field>
          {!editing ? (
            <Field id={ids.copies} label="Copies" error={errors.copies} className="w-copies">
              <input
                id={ids.copies}
                className="input tabular"
                type="number"
                min={0}
                max={20}
                value={form.copies}
                onChange={set('copies')}
                aria-invalid={Boolean(errors.copies) || undefined}
                aria-describedby={describedBy(ids.copies, errors.copies, hints.copies)}
              />
            </Field>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}
