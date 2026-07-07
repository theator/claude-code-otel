import { useEffect, useRef, useState } from 'react'
import { Calendar, ChevronDown, RefreshCw, Clock } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  RANGES,
  REFRESH_OPTIONS,
  makeRange,
  makeCustomRange,
  setRange,
  setRefreshMs,
  useTimeRange,
  formatRangeLabel,
} from '@/lib/time'

function toLocalInput(s: number): string {
  // datetime-local needs YYYY-MM-DDTHH:mm in local time.
  const d = new Date(s * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalInput(v: string): number {
  return Math.floor(new Date(v).getTime() / 1000)
}

export function TimePicker() {
  const { range, refreshMs } = useTimeRange()
  const [open, setOpen] = useState<'range' | 'custom' | 'refresh' | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [customStart, setCustomStart] = useState(toLocalInput(range.start))
  const [customEnd, setCustomEnd] = useState(toLocalInput(range.end))

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  return (
    <div ref={ref} className="relative flex items-center gap-1 text-sm">
      {/* Range button */}
      <button
        onClick={() => setOpen(o => (o === 'range' ? null : 'range'))}
        className={cn(
          'flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-1.5 transition',
          open === 'range' ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]' : 'hover:bg-white/5',
        )}
      >
        <Clock size={14} />
        <span className="font-medium">{formatRangeLabel(range)}</span>
        <ChevronDown size={14} />
      </button>

      {/* Refresh button */}
      <button
        onClick={() => setOpen(o => (o === 'refresh' ? null : 'refresh'))}
        className={cn(
          'flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-1.5 transition',
          open === 'refresh' ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]' : 'hover:bg-white/5',
        )}
        title="Refresh interval"
      >
        <RefreshCw size={14} className={refreshMs ? 'animate-spin' : ''} style={refreshMs ? { animationDuration: `${Math.max(refreshMs, 1000)}ms` } : undefined} />
        <span>{REFRESH_OPTIONS.find(r => r.ms === refreshMs)?.label ?? 'Off'}</span>
        <ChevronDown size={14} />
      </button>

      {/* Range dropdown */}
      {open === 'range' && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-2 shadow-xl">
          {RANGES.map(r => (
            <button
              key={r.label}
              onClick={() => { setRange(makeRange(r.label, r.seconds)); setOpen(null) }}
              className={cn(
                'flex w-full items-center justify-between rounded px-3 py-1.5 text-left hover:bg-white/5',
                range.label === r.label && 'text-[var(--color-accent)]',
              )}
            >
              <span>Last {r.label}</span>
              {range.label === r.label && <span>✓</span>}
            </button>
          ))}
          <div className="my-1 border-t border-[var(--color-border)]" />
          <button
            onClick={() => { setCustomStart(toLocalInput(range.start)); setCustomEnd(toLocalInput(range.end)); setOpen('custom') }}
            className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left hover:bg-white/5"
          >
            <Calendar size={14} /> Custom range…
          </button>
        </div>
      )}

      {/* Custom range popover */}
      {open === 'custom' && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 shadow-xl">
          <div className="mb-2 text-xs uppercase tracking-wide text-[var(--color-muted)]">Custom time range</div>
          <label className="mb-1 block text-xs text-[var(--color-muted)]">From</label>
          <input
            type="datetime-local"
            value={customStart}
            onChange={e => setCustomStart(e.target.value)}
            className="mb-2 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm [color-scheme:dark]"
          />
          <label className="mb-1 block text-xs text-[var(--color-muted)]">To</label>
          <input
            type="datetime-local"
            value={customEnd}
            onChange={e => setCustomEnd(e.target.value)}
            className="mb-3 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm [color-scheme:dark]"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen('range')} className="rounded px-3 py-1 text-sm text-[var(--color-muted)] hover:bg-white/5">Back</button>
            <button
              onClick={() => {
                const s = fromLocalInput(customStart)
                const e = fromLocalInput(customEnd)
                if (isFinite(s) && isFinite(e) && s < e) {
                  setRange(makeCustomRange(s, e))
                  setOpen(null)
                }
              }}
              className="rounded bg-[var(--color-accent)] px-3 py-1 text-sm font-medium text-black"
            >
              Apply
            </button>
          </div>
        </div>
      )}

      {/* Refresh dropdown */}
      {open === 'refresh' && (
        <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-2 shadow-xl">
          {REFRESH_OPTIONS.map(r => (
            <button
              key={r.label}
              onClick={() => { setRefreshMs(r.ms); setOpen(null) }}
              className={cn(
                'flex w-full items-center justify-between rounded px-3 py-1.5 text-left hover:bg-white/5',
                refreshMs === r.ms && 'text-[var(--color-accent)]',
              )}
            >
              <span>{r.label}</span>
              {refreshMs === r.ms && <span>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}