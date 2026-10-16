// Thin fetch wrapper for the ShelfWise API. Every call is relative (/api/...),
// so the same build works behind nginx, the Vite dev proxy or `vite preview`.
//
// Failures always reject with an ApiError carrying { status, code, message }:
//   409 / 404  -> the server's own sentence ("detail") and rule code
//   422        -> FastAPI validation errors turned into "Field: message" text,
//                 plus `fields` ({ isbn: "...", ... }) for inline form errors
//   network    -> status 0, code "network" / "timeout"
//   5xx        -> code "unavailable" (e.g. nginx 502 while pods roll)

const BASE = '/api'
const TIMEOUT_MS = 15000

export class ApiError extends Error {
  constructor({ status, code, message, fields = {} }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

const FIELD_LABELS = {
  isbn: 'ISBN',
  published_year: 'Published year',
  member_type: 'Member type',
  member_id: 'Member',
  book_id: 'Book',
  copy_id: 'Copy',
}

export function fieldLabel(name) {
  if (FIELD_LABELS[name]) return FIELD_LABELS[name]
  const words = String(name).replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function friendlyMessage(item) {
  const ctx = item.ctx || {}
  switch (item.type) {
    case 'missing':
      return 'This field is required'
    case 'string_too_short':
      return ctx.min_length === 1 ? 'This field is required' : `Use at least ${ctx.min_length} characters`
    case 'string_too_long':
      return `Use at most ${ctx.max_length} characters`
    case 'greater_than_equal':
      return `Must be ${ctx.ge} or more`
    case 'less_than_equal':
      return `Must be ${ctx.le} or less`
    case 'int_parsing':
    case 'int_from_float':
      return 'Enter a whole number'
    case 'literal_error':
      return `Choose one of ${ctx.expected}`
    default:
      break
  }
  let msg = String(item.msg || 'Invalid value')
  msg = msg.replace(/^Value error, /, '').replace(/^value is not a valid email address: /, '')
  return msg.charAt(0).toUpperCase() + msg.slice(1)
}

function parseValidation(detail) {
  const fields = {}
  const parts = []
  for (const item of detail) {
    const loc = (item.loc || []).filter((p) => p !== 'body' && p !== 'query' && p !== 'path')
    const field = loc.length ? String(loc[loc.length - 1]) : null
    const msg = friendlyMessage(item)
    if (field && !(field in fields)) fields[field] = msg
    parts.push(field ? `${fieldLabel(field)}: ${msg}` : msg)
  }
  return { fields, message: parts.join(' · ') || 'The request was not valid' }
}

function toError(status, data) {
  const detail = data && data.detail
  if (status === 422 && Array.isArray(detail)) {
    const { fields, message } = parseValidation(detail)
    return new ApiError({ status, code: 'validation_error', message, fields })
  }
  if (typeof detail === 'string' && detail) {
    return new ApiError({ status, code: data.code || `http_${status}`, message: detail })
  }
  if (status === 502 || status === 503 || status === 504) {
    return new ApiError({
      status,
      code: 'unavailable',
      message: `The ShelfWise API isn’t reachable right now (HTTP ${status} from the gateway). It may be restarting; try again in a moment.`,
    })
  }
  if (status >= 500) {
    return new ApiError({
      status,
      code: 'server_error',
      message: `The ShelfWise server hit an error (HTTP ${status}). Try again in a moment.`,
    })
  }
  return new ApiError({ status, code: `http_${status}`, message: `The request failed (HTTP ${status}).` })
}

async function request(method, path, body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  try {
    let res
    try {
      res = await fetch(BASE + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      })
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new ApiError({
          status: 0,
          code: 'timeout',
          message: 'The server took too long to answer. Try again in a moment.',
        })
      }
      throw new ApiError({
        status: 0,
        code: 'network',
        message: 'Cannot reach the ShelfWise server. Check that the API is running, then try again.',
      })
    }
    if (res.status === 204) return null
    const text = await res.text()
    let data = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = null
      }
    }
    if (!res.ok) throw toError(res.status, data)
    return data
  } finally {
    clearTimeout(timer)
  }
}

function qs(params = {}) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue
    search.set(key, String(value))
  }
  const s = search.toString()
  return s ? `?${s}` : ''
}

const get = (path) => request('GET', path)
const post = (path, body) => request('POST', path, body)
const put = (path, body) => request('PUT', path, body)
const del = (path) => request('DELETE', path)

export const api = {
  info: () => get('/info'),
  stats: () => get('/stats'),
  activity: (limit = 20) => get(`/activity${qs({ limit })}`),

  books: (params) => get(`/books${qs(params)}`),
  book: (id) => get(`/books/${id}`),
  createBook: (data) => post('/books', data),
  updateBook: (id, data) => put(`/books/${id}`, data),
  deleteBook: (id) => del(`/books/${id}`),
  addCopy: (bookId, data) => post(`/books/${bookId}/copies`, data),
  updateCopy: (id, data) => put(`/copies/${id}`, data),
  withdrawCopy: (id) => del(`/copies/${id}`),

  members: (params) => get(`/members${qs(params)}`),
  member: (id) => get(`/members/${id}`),
  createMember: (data) => post('/members', data),
  updateMember: (id, data) => put(`/members/${id}`, data),
  closeMember: (id) => del(`/members/${id}`),

  loans: (params) => get(`/loans${qs(params)}`),
  lend: (data) => post('/loans', data),
  returnLoan: (id) => post(`/loans/${id}/return`),
  renewLoan: (id) => post(`/loans/${id}/renew`),
  reportLost: (id) => post(`/loans/${id}/lost`),
  payFine: (id) => post(`/loans/${id}/pay`),

  holds: (params) => get(`/holds${qs(params)}`),
  placeHold: (data) => post('/holds', data),
  cancelHold: (id) => del(`/holds/${id}`),
}
