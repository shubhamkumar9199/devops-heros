import { Skeleton } from './States.jsx'

/**
 * A table on wide screens that turns into stacked cards under 760px.
 *
 * columns: [{
 *   key, header, render(row),
 *   label      card-view label (defaults to header),
 *   primary    full-width title cell in card view,
 *   actions    right-aligned action cell (full width in card view),
 *   align      'right' for numbers,
 *   className  extra td/th class (e.g. 'hide-md' to drop on mid widths)
 * }]
 * onRowClick makes rows open something; the primary cell then renders a real
 * button (rowLabel) so the row is reachable by keyboard.
 * compactActions keeps a single action button beside the last value in card view.
 */
export default function DataTable({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowLabel,
  rowClassName,
  loading = false,
  skeletonRows = 6,
  empty = null,
  caption,
  dense = false,
  refreshing = false,
  compactActions = false,
}) {
  const showSkeleton = loading && !rows
  if (!showSkeleton && rows && rows.length === 0) return empty

  const cellClass = (col) =>
    [
      col.primary ? 'cell-primary' : '',
      col.actions ? 'cell-actions' : '',
      col.align === 'right' ? 'num' : '',
      col.className || '',
    ]
      .filter(Boolean)
      .join(' ')

  const handleRowClick = (event, row) => {
    if (!onRowClick) return
    const interactive = event.target.closest('a, button, input, select, textarea, label')
    if (interactive && !interactive.classList.contains('row-link')) return
    onRowClick(row)
  }

  return (
    <div className={`table-wrap ${refreshing ? 'is-refreshing' : ''}`}>
      <table
        className={`table ${dense ? 'table-dense' : ''} ${onRowClick ? 'table-clickable' : ''} ${
          compactActions ? 'table-compact-actions' : ''
        }`}
      >
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col" className={cellClass(col)}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {showSkeleton
            ? Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={`skeleton-${i}`} className="skeleton-row" aria-hidden="true">
                  {columns.map((col, c) => (
                    <td key={col.key} className={cellClass(col)}>
                      {col.actions ? (
                        <Skeleton width={64} height={26} radius={7} />
                      ) : (
                        <Skeleton width={col.primary ? `${70 - ((i * 13) % 30)}%` : `${55 + ((i + c) * 11) % 35}%`} />
                      )}
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className={rowClassName ? rowClassName(row) : undefined}
                  onClick={onRowClick ? (event) => handleRowClick(event, row) : undefined}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={cellClass(col)} data-label={col.primary || col.actions ? undefined : col.label ?? (typeof col.header === 'string' ? col.header : undefined)}>
                      {col.primary && onRowClick ? (
                        <button type="button" className="row-link" aria-label={rowLabel ? rowLabel(row) : undefined}>
                          {col.render(row)}
                        </button>
                      ) : (
                        col.render(row)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  )
}
