import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { todayInTimezone } from '@/lib/date-utils'
import { invalidateFinancialQueries } from '@/lib/invalidate-queries'
import { useEffectiveTimezone } from '@/hooks/use-timezone'

/** Refresh due-date projections when the workspace's calendar day changes. */
export function useFinancialDayRefresh() {
  const queryClient = useQueryClient()
  const timeZone = useEffectiveTimezone()

  useEffect(() => {
    let observedDay = todayInTimezone(timeZone)
    const refreshIfDayChanged = () => {
      const currentDay = todayInTimezone(timeZone)
      if (currentDay === observedDay) return
      observedDay = currentDay
      invalidateFinancialQueries(queryClient)
    }

    const timer = window.setInterval(refreshIfDayChanged, 60_000)
    window.addEventListener('focus', refreshIfDayChanged)
    document.addEventListener('visibilitychange', refreshIfDayChanged)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshIfDayChanged)
      document.removeEventListener('visibilitychange', refreshIfDayChanged)
    }
  }, [queryClient, timeZone])
}
