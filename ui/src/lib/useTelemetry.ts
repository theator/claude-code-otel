import { useQuery } from '@tanstack/react-query'
import { useTimeRange, rangeSelector, stepFor } from './time'

// Wraps useQuery so every panel honors the shared time range + refresh interval.
export function useRangeQuery<T>(key: string[], fetcher: (range: { start: number; end: number; step: number; selector: string }) => Promise<T>) {
  const { range, refreshMs } = useTimeRange()
  return useQuery({
    queryKey: [...key, range.start, range.end],
    queryFn: () => fetcher({ start: range.start, end: range.end, step: stepFor(range), selector: rangeSelector(range) }),
    refetchInterval: refreshMs || false,
    refetchIntervalInBackground: false,
    staleTime: Math.min(refreshMs || 30_000, 30_000),
  })
}

// Same but without the time range (e.g. for fixed trace fetches).
export function useTelemetryQuery<T>(key: string[], fetcher: () => Promise<T>, refreshMs = 30_000) {
  const { refreshMs: globalRefresh } = useTimeRange()
  return useQuery({
    queryKey: key,
    queryFn: fetcher,
    refetchInterval: (globalRefresh || refreshMs) || false,
    refetchIntervalInBackground: false,
  })
}