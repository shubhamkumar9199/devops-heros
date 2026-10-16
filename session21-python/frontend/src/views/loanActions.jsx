import { useState } from 'react'
import { api } from '../api.js'
import Button from '../components/Button.jsx'
import { useApp } from '../context.js'
import { formatDay, formatMoney, plural } from '../format.js'

/** Which actions a loan's state allows. Rules the UI can't see (e.g. a hold queue) are left to the server. */
export function allowedActions(loan) {
  if (loan.status === 'active') {
    return { ret: true, renew: !loan.is_overdue && loan.renewals_left > 0, lost: true, pay: false }
  }
  return { ret: false, renew: false, lost: false, pay: loan.fine_amount > 0 && !loan.fine_paid }
}

/** Return / renew / report lost / mark fine paid, with confirm + toasts. */
export function useLoanActions() {
  const { run, confirm, policy } = useApp()
  const [busy, setBusy] = useState(null)

  const act = async (key, fn, options) => {
    setBusy(key)
    try {
      return await run(fn, options)
    } finally {
      setBusy(null)
    }
  }

  const returnLoan = (loan) =>
    act(`return-${loan.id}`, () => api.returnLoan(loan.id), {
      success: (l) =>
        l.fine_amount
          ? `“${l.book_title}” is back from ${l.member_name}, ${plural(l.days_overdue, 'day')} late. Fine: ${formatMoney(l.fine_amount)}.`
          : `“${l.book_title}” is back from ${l.member_name}.`,
      failure: `Couldn’t return “${loan.book_title}”`,
    })

  const renew = (loan) =>
    act(`renew-${loan.id}`, () => api.renewLoan(loan.id), {
      success: (l) =>
        `“${l.book_title}” renewed for ${l.member_name}. Now due ${formatDay(l.due_at)} (${plural(l.renewals_left, 'renewal')} left).`,
      failure: `Couldn’t renew “${loan.book_title}”`,
    })

  const reportLost = async (loan) => {
    const ok = await confirm({
      title: `Report ${loan.barcode} lost?`,
      message: `The loan of “${loan.book_title}” closes and ${loan.member_name} is charged the ${formatMoney(
        policy.lost_fee,
      )} replacement fee. This can’t be undone.`,
      confirmLabel: 'Report lost',
    })
    if (!ok) return null
    return act(`lost-${loan.id}`, () => api.reportLost(loan.id), {
      success: (l) => `${l.barcode} is recorded as lost. ${l.member_name} owes the ${formatMoney(l.fine_amount)} fee.`,
      failure: `Couldn’t report ${loan.barcode} lost`,
    })
  }

  const pay = (loan) =>
    act(`pay-${loan.id}`, () => api.payFine(loan.id), {
      success: (l) => `${formatMoney(l.fine_amount)} from ${l.member_name} recorded as paid.`,
      failure: 'Couldn’t record the payment',
    })

  return { busy, returnLoan, renew, reportLost, pay }
}

/** The buttons valid for this loan. */
export function LoanActionButtons({ loan, actions, size = 'sm' }) {
  const allowed = allowedActions(loan)
  if (!allowed.ret && !allowed.renew && !allowed.lost && !allowed.pay) return null
  const { busy } = actions
  const any = busy !== null
  return (
    <div className="row-actions">
      {allowed.ret ? (
        <Button
          size={size}
          variant="primary"
          icon="arrowIn"
          busy={busy === `return-${loan.id}`}
          disabled={any}
          onClick={() => actions.returnLoan(loan)}
        >
          Return
        </Button>
      ) : null}
      {allowed.renew ? (
        <Button
          size={size}
          icon="renew"
          busy={busy === `renew-${loan.id}`}
          disabled={any}
          onClick={() => actions.renew(loan)}
          title={`${plural(loan.renewals_left, 'renewal')} left`}
        >
          Renew
        </Button>
      ) : null}
      {allowed.lost ? (
        <Button
          size={size}
          variant="ghost"
          icon="lost"
          busy={busy === `lost-${loan.id}`}
          disabled={any}
          onClick={() => actions.reportLost(loan)}
          aria-label={`Report ${loan.barcode} lost`}
          title="Report lost"
          className="btn-quiet-danger"
        >
          Lost
        </Button>
      ) : null}
      {allowed.pay ? (
        <Button
          size={size}
          variant="primary"
          icon="rupee"
          busy={busy === `pay-${loan.id}`}
          disabled={any}
          onClick={() => actions.pay(loan)}
        >
          Mark {formatMoney(loan.fine_amount)} paid
        </Button>
      ) : null}
    </div>
  )
}
