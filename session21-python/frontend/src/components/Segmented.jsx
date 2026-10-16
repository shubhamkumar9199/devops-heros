import { useRef } from 'react'

/**
 * Tab-style segmented control (role=tablist, arrow keys move between tabs).
 * options: [{ value, label, count?, tone? }]
 */
export default function Segmented({ id, label, options, value, onChange }) {
  const refs = useRef([])

  const onKeyDown = (event, index) => {
    let next = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = options.length - 1
    if (next === null) return
    event.preventDefault()
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${option.value}`}
            aria-selected={selected}
            aria-controls={`${id}-panel`}
            tabIndex={selected ? 0 : -1}
            className="segment"
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span>{option.label}</span>
            {option.count != null ? (
              <span className={`segment-count ${option.tone ? `tone-${option.tone}` : ''}`}>{option.count}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
