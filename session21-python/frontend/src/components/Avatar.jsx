const TINTS = 5

function hash(text) {
  let h = 0
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Initials in a muted tint picked from the name (identity only, never status). */
export default function Avatar({ name = '', size = 32 }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
  return (
    <span
      className={`avatar avatar-${hash(name) % TINTS}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden="true"
    >
      {initials || '?'}
    </span>
  )
}
