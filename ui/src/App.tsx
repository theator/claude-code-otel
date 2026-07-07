import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Activity, LayoutDashboard, ListTree, RefreshCw } from 'lucide-react'
import { useRoute, navigate, type Route } from './router'
import { OverviewView } from './views/OverviewView'
import { SessionsView } from './views/SessionsView'
import { SessionDetailView } from './views/SessionDetailView'
import { TimePicker } from './components/TimePicker'
import { cn } from '@/lib/cn'

function NavItem({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition',
        active
          ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
          : 'text-[var(--color-muted)] hover:bg-white/5 hover:text-[var(--color-text)]',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function useLastUpdated(): { secsAgo: number | null } {
  const qc = useQueryClient()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const queries = qc.getQueryCache().getAll()
  const latest = queries.reduce((m, q) => Math.max(m, q.state.dataUpdatedAt ?? 0), 0)
  if (!latest) return { secsAgo: null }
  return { secsAgo: Math.max(0, Math.floor((now - latest) / 1000)) }
}

function RefreshButton() {
  const qc = useQueryClient()
  const [spin, setSpin] = useState(false)
  return (
    <button
      onClick={() => {
        setSpin(true)
        qc.invalidateQueries()
        setTimeout(() => setSpin(false), 700)
      }}
      className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-muted)] transition hover:bg-white/5 hover:text-[var(--color-text)]"
      title="Refresh all panels"
    >
      <RefreshCw size={13} className={spin ? 'animate-spin' : ''} />
    </button>
  )
}

function LastUpdatedPill() {
  const { secsAgo } = useLastUpdated()
  const label = secsAgo === null ? '—' : secsAgo < 1 ? 'now' : `${secsAgo}s ago`
  const stale = secsAgo !== null && secsAgo > 60
  return (
    <span
      className={cn(
        'hidden items-center gap-1.5 text-xs sm:flex',
        stale ? 'text-[var(--color-yellow)]' : 'text-[var(--color-muted)]',
      )}
      title="Time since most-recent panel data refreshed"
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', stale ? 'bg-[var(--color-yellow)]' : 'bg-[var(--color-green)] animate-pulse')} />
      updated {label}
    </span>
  )
}

export function App() {
  const route = useRoute()
  const active: Route['name'] =
    route.name === 'session' ? 'sessions' : route.name

  return (
    <div className="min-h-screen p-6">
      <header className="mb-6 flex items-center gap-4">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--color-green)]" />
          <h1 className="text-xl font-semibold">Claude Code Telemetry</h1>
        </div>
        <nav className="ml-6 flex gap-1">
          <NavItem
            active={active === 'overview'}
            onClick={() => navigate({ name: 'overview' })}
            icon={<LayoutDashboard size={16} />}
            label="Overview"
          />
          <NavItem
            active={active === 'sessions'}
            onClick={() => navigate({ name: 'sessions' })}
            icon={<ListTree size={16} />}
            label="Sessions"
          />
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <LastUpdatedPill />
          <span className="hidden items-center gap-2 text-xs text-[var(--color-muted)] lg:flex">
            <Activity size={12} /> live
          </span>
          <RefreshButton />
          <TimePicker />
        </div>
      </header>

      {route.name === 'overview' && <OverviewView />}
      {route.name === 'sessions' && <SessionsView />}
      {route.name === 'session' && <SessionDetailView sessionId={route.id} />}
    </div>
  )
}