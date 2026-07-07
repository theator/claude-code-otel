import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = 'var(--color-accent)',
  fill = true,
  className,
}: {
  data: number[]
  width?: number
  height?: number
  color?: string
  fill?: boolean
  className?: string
}) {
  if (!data || data.length < 2) {
    return <svg width={width} height={height} className={className} />
  }
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const pad = 2
  const w = width - pad * 2
  const h = height - pad * 2
  const stepX = w / (data.length - 1)
  const pts = data.map((v, i) => {
    const x = pad + i * stepX
    const y = pad + h - ((v - min) / span) * h
    return [x, y] as const
  })
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const areaPath = `${line} L${pts[pts.length - 1][0].toFixed(1)},${pad + h} L${pts[0][0].toFixed(1)},${pad + h} Z`
  const last = pts[pts.length - 1]
  const first = pts[0]
  const trendUp = last[1] <= first[1]
  const gid = `spark-${Math.round(Math.random() * 1e9)}`
  return (
    <svg width={width} height={height} className={className} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {fill && <path d={areaPath} fill={`url(#${gid})`} stroke="none" />}
      <path d={line} fill="none" stroke={color} strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r={1.6} fill={trendUp ? 'var(--color-green)' : 'var(--color-red)'} />
    </svg>
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">{children}</h3>
      {right}
    </div>
  )
}

export function Kpi({
  label,
  value,
  delta,
  spark,
  sparkColor = 'var(--color-accent)',
}: {
  label: string
  value: ReactNode
  delta?: ReactNode
  spark?: number[]
  sparkColor?: string
}) {
  return (
    <Card className={spark ? 'p-3' : undefined}>
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">{label}</div>
        {spark && spark.length > 1 && <Sparkline data={spark} color={sparkColor} width={96} height={28} />}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {delta && <div className="mt-0.5 text-xs">{delta}</div>}
    </Card>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-10 text-center text-[var(--color-muted)]">
      <div className="text-3xl">∅</div>
      <div className="text-sm">{children}</div>
    </div>
  )
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center p-10">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)]" />
    </div>
  )
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="p-4 text-sm text-[var(--color-red)]">
      <strong>Error:</strong> {message}
    </div>
  )
}

export function Tag({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span
      className="rounded px-2 py-0.5 text-[11px] font-medium"
      style={{ background: `${color}22`, color }}
    >
      {children}
    </span>
  )
}