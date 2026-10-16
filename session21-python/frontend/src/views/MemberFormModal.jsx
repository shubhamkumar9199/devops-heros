import { useState } from 'react'
import { api } from '../api.js'
import Button from '../components/Button.jsx'
import { describedBy, Field, FormAlert } from '../components/Field.jsx'
import Modal from '../components/Modal.jsx'
import { useApp } from '../context.js'
import { capitalise } from '../format.js'

/** Add a member or edit one (PUT replaces name, email and type). */
export default function MemberFormModal({ member, onClose, onSaved }) {
  const { policy, toast, bump } = useApp()
  const editing = Boolean(member)
  const types = Object.keys(policy.members)
  const [form, setForm] = useState(() => ({
    name: member ? member.name : '',
    email: member ? member.email : '',
    member_type: member ? member.member_type : types[0],
  }))
  const [errors, setErrors] = useState({})
  const [failure, setFailure] = useState(null)
  const [busy, setBusy] = useState(false)

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const submit = async (event) => {
    event.preventDefault()
    const local = {}
    if (form.name.trim().length < 2) local.name = 'Enter the member’s full name'
    if (!form.email.trim()) local.email = 'Enter an email address'
    setErrors(local)
    setFailure(null)
    if (Object.keys(local).length) return
    setBusy(true)
    const payload = { name: form.name.trim(), email: form.email.trim(), member_type: form.member_type }
    try {
      const saved = editing ? await api.updateMember(member.id, payload) : await api.createMember(payload)
      toast.success(
        editing ? `${saved.name}’s details were saved.` : `${saved.name} joined as a ${saved.member_type} with card ${saved.card_number}.`,
        editing ? 'Member saved' : 'Member added',
      )
      bump()
      if (onSaved) onSaved(saved)
      else onClose()
    } catch (err) {
      if (err.status === 422 && Object.keys(err.fields).length) setErrors(err.fields)
      else if (err.code === 'email_exists') setErrors({ email: err.message })
      else setFailure(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={editing ? `Edit ${member.name}` : 'Add a member'}
      description={editing ? `Card ${member.card_number}` : 'A library card number is issued when you save.'}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy} icon={editing ? 'check' : 'userPlus'}>
            {editing ? 'Save changes' : 'Add member'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        {failure ? <FormAlert title="Couldn’t save the member">{failure.message}</FormAlert> : null}
        <Field id="member-name" label="Full name" error={errors.name}>
          <input
            id="member-name"
            className="input"
            value={form.name}
            maxLength={120}
            autoComplete="off"
            onChange={(e) => set('name', e.target.value)}
            aria-invalid={Boolean(errors.name) || undefined}
            aria-describedby={describedBy('member-name', errors.name)}
            data-autofocus=""
          />
        </Field>
        <Field id="member-email" label="Email" error={errors.email}>
          <input
            id="member-email"
            className="input"
            type="email"
            value={form.email}
            autoComplete="off"
            spellCheck="false"
            placeholder="name@campus.example"
            onChange={(e) => set('email', e.target.value)}
            aria-invalid={Boolean(errors.email) || undefined}
            aria-describedby={describedBy('member-email', errors.email)}
          />
        </Field>
        <fieldset className="field choice-field">
          <legend className="field-label">Member type</legend>
          <div className="choices">
            {types.map((type) => {
              const rule = policy.members[type]
              return (
                <label key={type} className={`choice ${form.member_type === type ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="member_type"
                    value={type}
                    checked={form.member_type === type}
                    onChange={() => set('member_type', type)}
                  />
                  <span className="choice-body">
                    <span className="choice-title">{capitalise(type)}</span>
                    <span className="choice-sub">
                      Up to {rule.max_loans} books for {rule.loan_days} days
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
          {errors.member_type ? <p className="field-error">{errors.member_type}</p> : null}
        </fieldset>
      </div>
    </Modal>
  )
}
