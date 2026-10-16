// Inline SVG icons (24px grid, 1.8px strokes). No icon font, nothing external.

const BOOKMARK = 'M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4-6.5 4v-16a1 1 0 0 1 1-1z'
const BOOK = 'M5 5.5A1.5 1.5 0 0 1 6.5 4H18.5v13.5H6.5A1.5 1.5 0 0 0 5 19z'
const PERSON = (
  <>
    <circle cx="10" cy="8.5" r="3.5" />
    <path d="M3.5 19.5c.6-3.3 3.2-5.5 6.5-5.5 1.4 0 2.7.4 3.7 1.1" />
  </>
)

const ICONS = {
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="9" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1.6" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1.6" />
      <rect x="3.5" y="15.5" width="7" height="5" rx="1.6" />
    </>
  ),
  books: (
    <>
      <rect x="3.5" y="4" width="4.5" height="15" rx="0.9" />
      <rect x="9.5" y="6" width="4.5" height="13" rx="0.9" />
      <path d="m15.6 7.3 3.2-.8 3 12.1-3.2.8z" />
      <path d="M2.5 21h19" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.8 19.5c.6-3.3 3.1-5.5 6.2-5.5s5.6 2.2 6.2 5.5" />
      <path d="M15.5 5.3a3.3 3.3 0 0 1 0 6.4" />
      <path d="M17.6 14.3c2 .7 3.3 2.6 3.6 5.2" />
    </>
  ),
  loans: (
    <>
      <path d="M4 8h14.5" />
      <path d="m15 4.5 3.5 3.5-3.5 3.5" />
      <path d="M20 16H5.5" />
      <path d="m9 12.5-3.5 3.5L9 19.5" />
    </>
  ),
  holds: <path d={BOOKMARK} />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.4-4.4" />
    </>
  ),
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  alert: (
    <>
      <path d="M10.3 4.6a2 2 0 0 1 3.4 0l7.2 12.6a2 2 0 0 1-1.7 3H4.8a2 2 0 0 1-1.7-3z" />
      <path d="M12 9.5v4.2M12 16.9v.1" />
    </>
  ),
  alertCircle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.8v5M12 16.2v.1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.2M12 7.8v.1" />
    </>
  ),
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.2 12.3 2.6 2.6 5-5.3" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6 6 12 12" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4h-4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </>
  ),
  rupee: <path d="M7 4.5h10M7 8.5h10M7 4.5h3.2a4 4 0 0 1 0 8H7l7.5 7" />,
  rupeeCircle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9 8h6M9 10.6h6M9 8h2.2a2.6 2.6 0 0 1 0 5.2H9l4.2 3.3" />
    </>
  ),
  book: (
    <>
      <path d={BOOK} />
      <path d="M5 19a1.5 1.5 0 0 0 1.5 1.5h12v-3" />
    </>
  ),
  bookPlus: (
    <>
      <path d={BOOK} />
      <path d="M5 19a1.5 1.5 0 0 0 1.5 1.5h12v-3" />
      <path d="M11.8 7.5v6M8.8 10.5h6" />
    </>
  ),
  pencil: (
    <>
      <path d="M4.5 19.5l1-4L15.8 5.2a1.8 1.8 0 0 1 2.5 0l.5.5a1.8 1.8 0 0 1 0 2.5L8.5 18.5z" />
      <path d="M13.5 7.5l3 3" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
      <path d="M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12" />
      <path d="M10 11v5.5M14 11v5.5" />
    </>
  ),
  copies: (
    <>
      <rect x="8" y="8" width="11.5" height="11.5" rx="1.8" />
      <path d="M16 8V5.8A1.8 1.8 0 0 0 14.2 4H5.8A1.8 1.8 0 0 0 4 5.8v8.4A1.8 1.8 0 0 0 5.8 16H8" />
    </>
  ),
  archive: (
    <>
      <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
      <path d="M5 8.5V18a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18V8.5" />
      <path d="M10 12.5h4" />
    </>
  ),
  userPlus: (
    <>
      {PERSON}
      <path d="M18.5 13v6M15.5 16h6" />
    </>
  ),
  userMinus: (
    <>
      {PERSON}
      <path d="M15.5 16h6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.8 20c.7-3.6 3.6-6 7.2-6s6.5 2.4 7.2 6" />
    </>
  ),
  arrowOut: (
    <>
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </>
  ),
  arrowIn: (
    <>
      <path d="M17 7 7 17" />
      <path d="M15 17H7V9" />
    </>
  ),
  renew: (
    <>
      <path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3L19.5 9" />
      <path d="M19.5 4.5V9H15" />
      <path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4.5 15" />
      <path d="M4.5 19.5V15H9" />
    </>
  ),
  lost: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.5a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6M12 17v.1" />
    </>
  ),
  bell: (
    <>
      <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  hourglass: (
    <>
      <path d="M7 3.5h10M7 20.5h10" />
      <path d="M8 3.5v2.8a4 4 0 0 0 1.6 3.2L12 11.5l2.4-2a4 4 0 0 0 1.6-3.2V3.5" />
      <path d="M8 20.5v-2.8a4 4 0 0 1 1.6-3.2l2.4-2 2.4 2a4 4 0 0 1 1.6 3.2v2.8" />
    </>
  ),
  bookmarkPlus: (
    <>
      <path d={BOOKMARK} />
      <path d="M12 7.5v5M9.5 10h5" />
    </>
  ),
  bookmarkX: (
    <>
      <path d={BOOKMARK} />
      <path d="m10 8 4 4M14 8l-4 4" />
    </>
  ),
  bookmarkCheck: (
    <>
      <path d={BOOKMARK} />
      <path d="m9.3 10.2 1.9 1.9 3.6-3.8" />
    </>
  ),
  serverOff: (
    <>
      <rect x="3.5" y="4" width="17" height="7" rx="1.8" />
      <rect x="3.5" y="13" width="17" height="7" rx="1.8" />
      <path d="M7.5 7.5h.1M7.5 16.5h.1" />
      <path d="M3 3l18 18" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <circle cx="8.5" cy="11" r="2" />
      <path d="M5.8 15.5c.5-1.3 1.5-2 2.7-2s2.2.7 2.7 2M14 10h4M14 13.5h3" />
    </>
  ),
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  inbox: (
    <>
      <path d="M3.5 13.5 6 5.5h12l2.5 8" />
      <path d="M3.5 13.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5v-4.5h-5a3.5 3.5 0 0 1-7 0z" />
    </>
  ),
  pulse: <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />,
  gauge: (
    <>
      <path d="M4.5 17a8 8 0 1 1 15 0" />
      <path d="m12 13 3.5-4" />
    </>
  ),
}

export default function Icon({ name, size = 18, className = '', title, strokeWidth = 1.8 }) {
  const shape = ICONS[name]
  if (!shape) return null
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {shape}
    </svg>
  )
}
