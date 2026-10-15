import { describe, expect, it } from 'vitest'

import { closeDateForBill, closeDateInMonth, creditCardCycleBoundaries, isOpenCycleWindow, previousCloseDate } from './credit-card-cycle'

describe('cycle boundaries', () => {
  it.each([
    ['2026-09-03', 5, '2026-08-05', '2026-09-03'],
    ['2026-09-04', 5, '2026-09-04', '2026-10-04'],
    ['2026-07-05', 5, '2026-06-05', '2026-07-05'],
    ['2026-07-06', 5, '2026-07-06', '2026-08-04'],
    ['2026-08-01', 1, '2026-07-31', '2026-08-31'],
    ['2026-02-02', 1, '2026-02-02', '2026-03-01'],
    ['2026-02-27', 31, '2026-02-27', '2026-03-30'],
  ] as const)('classifies %s with close day %s without a gap', (reference, closeDay, start, end) => {
    expect(creditCardCycleBoundaries(closeDay, new Date(reference + 'T12:00:00'))).toEqual({ start, end })
  })
})

describe('nearest weekday close', () => {
  it('moves Saturday back and Sunday forward', () => {
    expect(closeDateInMonth(2026, 8, 5).toLocaleDateString('sv-SE')).toBe('2026-09-04')
    expect(closeDateInMonth(2026, 6, 5).toLocaleDateString('sv-SE')).toBe('2026-07-06')
  })

  it('handles an adjusted close across a month boundary', () => {
    expect(closeDateInMonth(2026, 7, 1).toLocaleDateString('sv-SE')).toBe('2026-07-31')
    expect(previousCloseDate('2026-07-31', 1)).toBe('2026-07-01')
  })
})

describe('closeDateForBill', () => {
  it('takes the close day of the due date month when it falls on or before the due date', () => {
    expect(closeDateForBill('2026-03-25', 16)).toBe('2026-03-16')
  })

  it('falls back to the previous month when the close day is after the due date', () => {
    expect(closeDateForBill('2026-03-05', 28)).toBe('2026-02-27')
  })

  it('clamps a close day that the month does not have', () => {
    expect(closeDateForBill('2026-03-05', 31)).toBe('2026-02-27')
  })

  it('crosses the year boundary', () => {
    expect(closeDateForBill('2026-01-05', 20)).toBe('2025-12-19')
  })

  it('returns the due date when no close day is configured', () => {
    expect(closeDateForBill('2026-03-25', null)).toBe('2026-03-25')
  })
})

describe('isOpenCycleWindow', () => {
  // Card closing on the 16th, bill due on the 25th. The newest bill is due
  // 2026-03-25, so the open cycle runs from 2026-03-16.
  const newestDue = '2026-03-25'
  const closeDay = 16

  it('accepts the cycle-math window the next-cycle arrow produces', () => {
    expect(isOpenCycleWindow('2026-03-17', newestDue, closeDay)).toBe(true)
  })

  it('accepts a window that starts inside the open cycle', () => {
    expect(isOpenCycleWindow('2026-03-20', newestDue, closeDay)).toBe(true)
  })

  it('rejects a hand-edited window that reaches back into billed history', () => {
    // Regression: picking 19/02 to 20/03 used to be read as the open cycle
    // because the end date matched no bill, and the resulting unbilled_only
    // hid every transaction the closed bills already carry.
    expect(isOpenCycleWindow('2026-02-19', newestDue, closeDay)).toBe(false)
  })

  it('rejects a window covering the whole history', () => {
    expect(isOpenCycleWindow('2025-01-01', newestDue, closeDay)).toBe(false)
  })

  it('rejects the day before the open cycle starts', () => {
    expect(isOpenCycleWindow('2026-03-15', newestDue, closeDay)).toBe(false)
  })

  it('handles a close day later in the month than the due day', () => {
    // Closes on the 28th, due on the 5th of the next month: the open cycle
    // starts 2026-02-28, before the newest bill's own due date.
    expect(isOpenCycleWindow('2026-02-28', '2026-03-05', 28)).toBe(true)
    expect(isOpenCycleWindow('2026-02-01', '2026-03-05', 28)).toBe(false)
  })

  it('falls back to the due date when the account has no close day', () => {
    expect(isOpenCycleWindow('2026-03-26', newestDue, null)).toBe(true)
    expect(isOpenCycleWindow('2026-03-20', newestDue, null)).toBe(false)
  })

  it('is false without a window start', () => {
    expect(isOpenCycleWindow('', newestDue, closeDay)).toBe(false)
  })
})
