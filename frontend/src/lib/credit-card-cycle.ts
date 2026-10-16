import { addDays, format, parseISO } from 'date-fns'

/** Adjust the configured closing day to the nearest weekday. */
export function closeDateInMonth(year: number, month: number, closeDay: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate()
  const close = new Date(year, month, Math.min(closeDay, lastDay))
  if (close.getDay() === 6) close.setDate(close.getDate() - 1)
  else if (close.getDay() === 0) close.setDate(close.getDate() + 1)
  return close
}

/** Find the close immediately before an adjusted close, including month shifts. */
export function previousCloseDate(closeDate: string, closeDay: number): string {
  const close = parseISO(closeDate + 'T00:00:00')
  let previous: Date | null = null
  for (let offset = -2; offset <= 1; offset++) {
    const month = new Date(close.getFullYear(), close.getMonth() + offset, 1)
    const candidate = closeDateInMonth(month.getFullYear(), month.getMonth(), closeDay)
    if (candidate < close && (!previous || candidate > previous)) previous = candidate
  }
  if (!previous) throw new Error('Previous credit-card close date not found')
  return format(previous, 'yyyy-MM-dd')
}

/** Derive a bill's cycle close date from the account's statement_close_day.
 * Pluggy doesn't expose the close date directly, but it's recoverable: the
 * close is the most recent occurrence of close_day, adjusted to the nearest
 * weekday, on or before the bill's due_date. Falls back to due_date when
 * close_day is not configured. */
export function closeDateForBill(billDueDate: string, closeDay: number | null | undefined): string {
  if (!closeDay) return billDueDate
  const due = parseISO(billDueDate + 'T00:00:00')
  const y = due.getFullYear()
  const m = due.getMonth()
  const sameMonth = closeDateInMonth(y, m, closeDay)
  if (sameMonth.getTime() <= due.getTime()) {
    return format(sameMonth, 'yyyy-MM-dd')
  }
  const py = m === 0 ? y - 1 : y
  const pm = m === 0 ? 11 : m - 1
  return format(closeDateInMonth(py, pm, closeDay), 'yyyy-MM-dd')
}

export function cycleEndForBill(billDueDate: string, closeDay: number | null | undefined): string {
  if (!closeDay) return billDueDate
  return format(addDays(parseISO(closeDateForBill(billDueDate, closeDay) + 'T00:00:00'), -1), 'yyyy-MM-dd')
}

/** A purchase on the adjusted close day starts the next cycle. */
export function creditCardCycleBoundaries(
  closeDay: number | null | undefined,
  reference: Date,
): { start: string; end: string } {
  if (!closeDay) {
    return {
      start: format(new Date(reference.getFullYear(), reference.getMonth() - 1, 1), 'yyyy-MM-dd'),
      end: format(reference, 'yyyy-MM-dd'),
    }
  }
  const ref = new Date(reference)
  ref.setHours(0, 0, 0, 0)
  const closes: Date[] = []
  for (let offset = -2; offset <= 2; offset++) {
    const month = new Date(ref.getFullYear(), ref.getMonth() + offset, 1)
    closes.push(closeDateInMonth(month.getFullYear(), month.getMonth(), closeDay))
  }
  const nextIndex = closes.findIndex(close => close > ref)
  if (nextIndex < 1) throw new Error('Credit-card cycle close date not found')
  return {
    start: format(closes[nextIndex - 1], 'yyyy-MM-dd'),
    end: format(addDays(closes[nextIndex], -1), 'yyyy-MM-dd'),
  }
}

/** True when `windowStart` falls inside the cycle that is still open, meaning
 * every transaction in the window is by definition unbilled.
 *
 * This is the question `unbilled_only` answers on the backend: it drops every
 * transaction already linked to a bill, which is right for the open cycle
 * (whose window can contain transactions already assigned to a bill by the
 * provider) and wrong for anything else.
 *
 * The open cycle starts on the newest bill's close day. A window
 * starting before that covers billed
 * history, and the caller must not ask for unbilled transactions only, or the
 * history disappears.
 *
 * Both arguments are `yyyy-MM-dd`, which compares chronologically as a string.
 */
export function isOpenCycleWindow(
  windowStart: string,
  newestBillDueDate: string,
  closeDay: number | null | undefined,
): boolean {
  if (!windowStart) return false
  return closeDay
    ? windowStart >= closeDateForBill(newestBillDueDate, closeDay)
    : windowStart >= newestBillDueDate
}
