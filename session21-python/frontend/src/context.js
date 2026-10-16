import { createContext, useContext } from 'react'

/**
 * App-wide services:
 *   info, policy        GET /api/info (build, pod, lending rules)
 *   stats               GET /api/stats, refreshed in the background
 *   version, bump()     data version; bump() after a change so every view reloads
 *   run(fn, opts)       run a mutation with success / error toasts
 *   toast               { success, error, info }
 *   confirm(opts)       Promise<boolean> from a confirm dialog
 *   openLend(preset), openHold(preset)
 */
export const AppContext = createContext(null)

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside <AppContext.Provider>')
  return ctx
}
