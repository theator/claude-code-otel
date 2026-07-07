import { useSyncExternalStore } from 'react'
import type { TimeRange } from './types'

export const RANGES: { label: string; seconds: number }[] = [
  { label: '15m', seconds: 900 },
  { label: '1h', seconds: 3600 },
  { label: '6h', seconds: 21600 },
  { label: '24h', seconds: 86400 },
  { label: '7d', seconds: 604800 },
]

export const REFRESH_OPTIONS: { label: string; ms: number }[] = [
  { label: 'Off', ms: 0 },
  { label: '10s', ms: 10_000 },
  { label: '30s', ms: 30_000 },
  { label: '1m', ms: 60_000 },
  { label: '5m', ms: 300_000 },
]

interface RangeState {
  range: TimeRange
  refreshMs: number
}

let state: RangeState = { range: makeRange('24h', 86400), refreshMs: 30_000 }
const listeners = new Set<() => void>()

export function makeRange(label: string, seconds: number): TimeRange {
  const end = Math.floor(Date.now() / 1000)
  return { start: end - seconds, end, label }
}

export function makeCustomRange(start: number, end: number): TimeRange {
  return { start, end, label: 'custom' }
}

export function setRange(range: TimeRange): void {
  state = { ...state, range }
  listeners.forEach(l => l())
}

export function setRefreshMs(ms: number): void {
  state = { ...state, refreshMs: ms }
  listeners.forEach(l => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function getSnapshot(): RangeState {
  return state
}

export function useTimeRange(): RangeState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// Step size (Prometheus resolution) — keep ~150-300 points per range.
export function stepFor(range: TimeRange): number {
  const span = range.end - range.start
  if (span <= 900) return 5
  if (span <= 3600) return 15
  if (span <= 21600) return 60
  if (span <= 86400) return 300
  return 1800
}

// Range string for PromQL increase(...) selectors.
export function rangeSelector(range: TimeRange): string {
  const span = range.end - range.start
  return `${span}s`
}

export function formatRangeLabel(r: TimeRange): string {
  if (r.label !== 'custom') return `Last ${r.label}`
  const fmt = (s: number) => new Date(s * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return `${fmt(r.start)} → ${fmt(r.end)}`
}