import { useRef, useState } from 'react'
import { formatNumber, plural } from '../format.js'

// Order matters: adjacent fills were checked for colour-blind separation
// (available | hold shelf | on loan | lost | withdrawn).
const SEGMENTS = [
  { key: 'available', label: 'On shelf' },
  { key: 'on_hold_shelf', label: 'Hold shelf' },
  { key: 'on_loan', label: 'On loan' },
  { key: 'lost', label: 'Lost' },
  { key: 'withdrawn', label: 'Withdrawn' },
]

/** Part-to-whole bar of every copy by status, with a legend that carries every value. */
export default function CirculationBar({ byStatus = {} }) {
  const [active, setActive] = useState(null)
  const [tip, setTip] = useState(null)
  const barRef = useRef(null)
  const total = SEGMENTS.reduce((sum, seg) => sum + (byStatus[seg.key] || 0), 0)
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0)

  const show = (seg, target) => {
    setActive(seg.key)
    if (!barRef.current || !target) return
    const bar = barRef.current.getBoundingClientRect()
    const rect = target.getBoundingClientRect()
    setTip({ seg, left: rect.left - bar.left + rect.width / 2 })
  }
  const hide = () => {
    setActive(null)
    setTip(null)
  }

  return (
    <div className="circ">
      <div className="circ-bar-wrap">
        <div ref={barRef} className="circ-bar" aria-hidden="true" onMouseLeave={hide}>
          {total === 0 ? <span className="circ-seg circ-empty" style={{ flexGrow: 1 }} /> : null}
          {SEGMENTS.filter((seg) => byStatus[seg.key] > 0).map((seg) => (
            <span
              key={seg.key}
              className={`circ-seg viz-${seg.key} ${active && active !== seg.key ? 'is-dim' : ''}`}
              style={{ flexGrow: byStatus[seg.key] }}
              onMouseEnter={(event) => show(seg, event.currentTarget)}
            />
          ))}
        </div>
        {tip ? (
          <div className="viz-tip" style={{ left: tip.left }} aria-hidden="true">
            <strong>{plural(byStatus[tip.seg.key] || 0, 'copy', 'copies')}</strong>
            <span>
              {tip.seg.label} · {pct(byStatus[tip.seg.key] || 0)}%
            </span>
          </div>
        ) : null}
      </div>
      <ul className="circ-legend" aria-label="Copies by status">
        {SEGMENTS.map((seg) => {
          const n = byStatus[seg.key] || 0
          return (
            <li
              key={seg.key}
              className={`circ-item ${active && active !== seg.key ? 'is-dim' : ''}`}
              onMouseEnter={() => n > 0 && setActive(seg.key)}
              onMouseLeave={hide}
            >
              <span className={`swatch viz-${seg.key}`} aria-hidden="true" />
              <span className="circ-label">{seg.label}</span>
              <span className="circ-value">{formatNumber(n)}</span>
              <span className="circ-pct">{pct(n)}%</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
