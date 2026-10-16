/** ShelfWise mark: three spines on a shelf, the last one leaning. */
export function LogoMark({ size = 34, framed = true }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      {framed ? <rect width="32" height="32" rx="8" fill="#0f2b2d" /> : null}
      {framed ? <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="#ffffff" strokeOpacity="0.12" /> : null}
      <rect x="7" y="9" width="4.5" height="15.5" rx="1.2" fill="#f5f2eb" />
      <rect x="12.75" y="6.5" width="4.5" height="18" rx="1.2" fill="#5cc8bd" />
      <rect x="19.5" y="10" width="4.5" height="14.5" rx="1.2" fill="#e7b04b" transform="rotate(-9 19.5 24.5)" />
      <rect x="5.5" y="24.5" width="21" height="2" rx="1" fill="#f5f2eb" opacity="0.6" />
    </svg>
  )
}

export function Wordmark() {
  return (
    <span className="wordmark">
      Shelf<span className="wordmark-accent">Wise</span>
    </span>
  )
}
