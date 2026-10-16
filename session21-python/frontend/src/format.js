// Formatting helpers. Dates are shown in the library's time zone (from
// /api/info), money in the policy currency, and "now" follows the server clock
// so relative times stay right even if this machine's clock drifts.

const LOCALE = 'en-IN'
const DAY_MS = 86400000

let tz = 'Asia/Kolkata'
let currency = 'INR'
let skew = 0
const cache = new Map()

export function configureFormat({ timezone, currency: cur, serverTime } = {}) {
  if (timezone) {
    try {
      new Intl.DateTimeFormat(LOCALE, { timeZone: timezone })
      tz = timezone
    } catch {
      // unknown zone: keep the previous one
    }
  }
  if (cur) currency = cur
  if (serverTime) {
    const t = Date.parse(serverTime)
    if (!Number.isNaN(t)) skew = t - Date.now()
  }
  cache.clear()
}

export const now = () => Date.now() + skew
export const timeZone = () => tz

function dtf(key, options) {
  let f = cache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, { timeZone: tz, ...options })
    cache.set(key, f)
  }
  return f
}

const toDate = (v) => (v instanceof Date ? v : new Date(v))
const yearOf = (d) => dtf('year', { year: 'numeric' }).format(d)

/** 16 Oct 2026 */
export function formatDate(v) {
  if (!v) return '—'
  return dtf('date', { day: 'numeric', month: 'short', year: 'numeric' }).format(toDate(v))
}

/** 16 Oct (adds the year when it is not this year) */
export function formatShort(v) {
  if (!v) return '—'
  const d = toDate(v)
  if (yearOf(d) !== yearOf(new Date(now()))) return formatDate(d)
  return dtf('short', { day: 'numeric', month: 'short' }).format(d)
}

/** Fri, 16 Oct (adds the year when it is not this year) */
export function formatDay(v) {
  if (!v) return '—'
  const d = toDate(v)
  if (yearOf(d) !== yearOf(new Date(now()))) return formatDate(d)
  return dtf('day', { weekday: 'short', day: 'numeric', month: 'short' }).format(d)
}

/** Friday, 16 October */
export function formatLongDay(v) {
  return dtf('long', { weekday: 'long', day: 'numeric', month: 'long' }).format(toDate(v))
}

/** 2:09 pm */
export function formatTime(v) {
  if (!v) return '—'
  return dtf('time', { hour: 'numeric', minute: '2-digit' }).format(toDate(v))
}

/** 2:09 pm IST (zone label follows the library time zone) */
export function formatClock(v) {
  return dtf('clock', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(toDate(v))
}

/** 16 Oct, 2:09 pm */
export function formatDateTime(v) {
  if (!v) return '—'
  return `${formatShort(v)}, ${formatTime(v)}`
}

/** Full timestamp for tooltips: 16 Oct 2026, 2:09 pm IST */
export function formatStamp(v) {
  if (!v) return ''
  return dtf('stamp', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(toDate(v))
}

function dayNumber(ms) {
  const parts = dtf('ymd', { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(ms))
  const part = (type) => Number(parts.find((p) => p.type === type).value)
  return Math.round(Date.UTC(part('year'), part('month') - 1, part('day')) / DAY_MS)
}

/** Calendar days from today (library time zone) to v: 0 today, 1 tomorrow, -1 yesterday. */
export function daysFromToday(v) {
  return dayNumber(toDate(v).getTime()) - dayNumber(now())
}

/** Calendar-day key for grouping (e.g. activity by day). */
export function dayKey(v) {
  return dayNumber(toDate(v).getTime())
}

/** "Today", "Yesterday" or "Wed, 14 Oct" */
export function dayHeading(v) {
  const d = daysFromToday(v)
  if (d === 0) return 'Today'
  if (d === -1) return 'Yesterday'
  return formatDay(v)
}

export function relativeTime(v) {
  if (!v) return ''
  const diff = toDate(v).getTime() - now()
  const abs = Math.abs(diff)
  const past = diff <= 0
  const MIN = 60000
  const HOUR = 3600000
  if (abs < 45000) return past ? 'just now' : 'in a moment'
  if (abs < 50 * MIN) {
    const m = Math.max(1, Math.round(abs / MIN))
    return past ? `${m} min ago` : `in ${m} min`
  }
  const days = daysFromToday(v)
  if (days === 0 || abs < 6 * HOUR) {
    const h = Math.max(1, Math.round(abs / HOUR))
    return past ? `${h} hr ago` : `in ${h} hr`
  }
  if (days === -1) return 'yesterday'
  if (days === 1) return 'tomorrow'
  if (Math.abs(days) < 14) return past ? `${-days} days ago` : `in ${days} days`
  return `on ${formatShort(v)}`
}

export function formatMoney(n) {
  const key = `money:${currency}`
  let f = cache.get(key)
  if (!f) {
    try {
      f = new Intl.NumberFormat(LOCALE, {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })
    } catch {
      f = new Intl.NumberFormat(LOCALE)
    }
    cache.set(key, f)
  }
  return f.format(n || 0)
}

export function formatNumber(n) {
  return new Intl.NumberFormat(LOCALE).format(n || 0)
}

export function plural(n, one, many = `${one}s`) {
  return `${formatNumber(n)} ${n === 1 ? one : many}`
}

export function capitalise(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

/** a1b2c3d4e5... -> a1b2c3d; other labels are kept, long ones trimmed. */
export function shortVersion(v) {
  if (!v) return 'unknown'
  const s = String(v).trim()
  if (/^[0-9a-f]{8,64}$/i.test(s)) return s.slice(0, 7)
  if (s.length > 16) return `${s.slice(0, 15)}…`
  return s
}

/** Greeting for the library's local hour. */
export function greeting() {
  const hour = Number(dtf('hour', { hour: 'numeric', hourCycle: 'h23' }).format(new Date(now())))
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

/** Due-date status of an active loan: { tone, text } */
export function dueInfo(loan) {
  if (!loan || loan.status !== 'active') return null
  if (loan.is_overdue) return { tone: 'red', text: `${plural(loan.days_overdue, 'day')} late` }
  const d = daysFromToday(loan.due_at)
  if (d <= 0) return { tone: 'amber', text: 'Due today' }
  if (d === 1) return { tone: 'amber', text: 'Due tomorrow' }
  if (d <= 3) return { tone: 'amber', text: `Due in ${d} days` }
  return { tone: 'muted', text: `Due in ${d} days` }
}

/** Pickup window of a ready hold: { tone, text } */
export function pickupInfo(hold) {
  if (!hold || hold.status !== 'ready' || !hold.expires_at) return null
  const left = toDate(hold.expires_at).getTime() - now()
  if (left <= 0) return { tone: 'red', text: 'Pickup window passed' }
  if (left < DAY_MS) return { tone: 'red', text: `Expires ${relativeTime(hold.expires_at)}` }
  return { tone: 'amber', text: `Expires ${relativeTime(hold.expires_at)}` }
}

/** Whole days since v (0 = today). */
export function daysSince(v) {
  return Math.max(0, -daysFromToday(v))
}
