import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { Spinner } from './States.jsx'

const MAX_OPTIONS = 60

/**
 * Searchable select (ARIA combobox + listbox). The list opens inline under the
 * input, so it is never clipped by a scrolling modal body.
 */
export default function Combobox({
  id,
  items,
  value,
  onChange,
  getKey,
  getLabel,
  matches,
  renderOption,
  placeholder,
  loading = false,
  emptyText = 'No matches',
  invalid = false,
  describedBy,
  autoFocus = false,
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActive] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const listId = `${id}-listbox`

  const selected = useMemo(
    () => (items || []).find((item) => getKey(item) === value) || null,
    [items, value, getKey],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = items || []
    return (q ? list.filter((item) => matches(item, q)) : list).slice(0, MAX_OPTIONS)
  }, [items, query, matches])

  // Keep the highlight on a real option, e.g. when items arrive after the user started typing.
  const active = Math.min(Math.max(activeIndex, 0), Math.max(filtered.length - 1, 0))

  useEffect(() => {
    if (!open || !listRef.current) return
    const node = listRef.current.querySelector('[data-active="true"]')
    if (node) node.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const choose = (item) => {
    onChange(getKey(item))
    setQuery('')
    setOpen(false)
  }

  const openList = () => {
    setOpen(true)
    const index = selected ? filtered.findIndex((item) => getKey(item) === getKey(selected)) : 0
    setActive(index > 0 ? index : 0)
  }

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) openList()
      else setActive(Math.min(active + 1, Math.max(filtered.length - 1, 0)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) openList()
      else setActive(Math.max(active - 1, 0))
    } else if (event.key === 'Enter') {
      if (open && filtered[active]) {
        event.preventDefault()
        choose(filtered[active])
      }
    } else if (event.key === 'Escape') {
      if (open) {
        // Close the list only; keep the dialog open.
        event.preventDefault()
        setOpen(false)
        setQuery('')
      }
    } else if (event.key === 'Tab') {
      setOpen(false)
      setQuery('')
    }
  }

  const shown = open ? query : selected ? getLabel(selected) : query
  const activeItem = open ? filtered[active] : null

  return (
    <div className={`combo ${open ? 'is-open' : ''}`}>
      <div className="combo-control">
        <Icon name="search" size={16} className="combo-icon" />
        <input
          ref={inputRef}
          id={id}
          className="input combo-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeItem ? `${id}-opt-${getKey(activeItem)}` : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          data-autofocus={autoFocus ? '' : undefined}
          autoComplete="off"
          spellCheck="false"
          placeholder={selected && open ? getLabel(selected) : placeholder}
          value={shown}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setActive(0)
          }}
          onFocus={openList}
          onClick={() => {
            if (!open) openList()
          }}
          onBlur={() => {
            setOpen(false)
            setQuery('')
          }}
          onKeyDown={onKeyDown}
        />
        {loading ? (
          <span className="combo-trailing">
            <Spinner size={14} />
          </span>
        ) : selected ? (
          <button
            type="button"
            className="combo-trailing combo-clear"
            aria-label="Clear selection"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange(null)
              setQuery('')
              inputRef.current?.focus()
            }}
          >
            <Icon name="x" size={14} />
          </button>
        ) : (
          <span className="combo-trailing" aria-hidden="true">
            <Icon name="chevronDown" size={16} />
          </span>
        )}
      </div>
      <ul id={listId} ref={listRef} role="listbox" className="combo-list" hidden={!open}>
        {loading && !items ? (
          <li className="combo-empty">Loading…</li>
        ) : filtered.length === 0 ? (
          <li className="combo-empty">{emptyText}</li>
        ) : (
          filtered.map((item, index) => {
            const key = getKey(item)
            const isSelected = selected && getKey(selected) === key
            return (
              <li
                key={key}
                id={`${id}-opt-${key}`}
                role="option"
                aria-selected={isSelected || false}
                data-active={index === active}
                className="combo-option"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(item)}
              >
                <div className="combo-option-body">{renderOption(item)}</div>
                {isSelected ? <Icon name="check" size={16} className="combo-check" /> : null}
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
