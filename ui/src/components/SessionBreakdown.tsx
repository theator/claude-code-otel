import { Fragment, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { AlertTriangle } from 'lucide-react'
import { EmptyState, Tag } from '@/components/ui'
import { fmtMs, fmtNum, cleanModel } from '@/lib/api'
import type { SessionTrace } from '@/lib/traces'
import { computeTurnRows } from '@/lib/traces'

const AXIS_LABEL = { color: '#8b949e', fontSize: 10 }
const SPLIT_LINE = { lineStyle: { color: '#30363d' } }

export function SpansPerTurnChart({ traces, height = 200 }: { traces: SessionTrace[]; height?: number }) {
  const option = useMemo(() => {
    const counts = traces.map(t => t.spans.length).filter(n => n > 0)
    if (counts.length === 0) return null
    const max = Math.max(...counts)
    const buckets = Math.min(12, Math.max(5, Math.ceil(max / 2)))
    const bucketSize = Math.max(1, Math.ceil((max + 1) / buckets))
    const hist = new Array(buckets).fill(0)
    const labels: string[] = []
    for (let i = 0; i < buckets; i++) {
      const lo = i * bucketSize
      const hi = i === buckets - 1 ? max : lo + bucketSize - 1
      labels.push(i === buckets - 1 ? `${lo}+` : `${lo}-${hi}`)
    }
    for (const c of counts) {
      const idx = Math.min(buckets - 1, Math.floor((c - 1) / bucketSize))
      hist[idx]++
    }
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (p: { name: string; value: number }[]) => `${p[0].name} spans: <b>${p[0].value}</b> turns` },
      grid: { left: 40, right: 20, top: 10, bottom: 30 },
      xAxis: { type: 'category', data: labels, name: 'spans', nameTextStyle: { color: '#8b949e', fontSize: 10 }, axisLabel: AXIS_LABEL },
      yAxis: { type: 'value', name: 'turns', nameTextStyle: { color: '#8b949e', fontSize: 10 }, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE },
      series: [{ type: 'bar', data: hist, itemStyle: { color: '#58a6ff', borderRadius: [3, 3, 0, 0] } }],
    }
  }, [traces])
  if (!option) return <EmptyState>No span data</EmptyState>
  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'canvas' }} />
}

export function PerTurnTable({ traces }: { traces: SessionTrace[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const rows = useMemo(() => computeTurnRows(traces), [traces])
  if (rows.length === 0) return <EmptyState>No turns in range</EmptyState>
  const maxSpans = Math.max(...rows.map(r => r.spans))
  return (
    <div className="max-h-[420px] overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-[var(--color-card)] text-[var(--color-muted)]">
          <tr className="border-b border-[var(--color-border)]">
            <th className="px-3 py-2 text-left font-medium">Turn</th>
            <th className="px-3 py-2 text-right font-medium" title="Wall-clock duration of the interaction span">Dur</th>
            <th className="px-3 py-2 text-right font-medium" title="Number of spans in the trace">Spans</th>
            <th className="px-3 py-2 text-right font-medium">LLM</th>
            <th className="px-3 py-2 text-right font-medium">Tools</th>
            <th className="px-3 py-2 text-right font-medium" title="Input / cache-read tokens">In</th>
            <th className="px-3 py-2 text-right font-medium" title="Output tokens">Out</th>
            <th className="px-3 py-2 text-right font-medium" title="First-token latency">TTFT</th>
            <th className="px-3 py-2 text-right font-medium">Err</th>
            <th className="px-3 py-2 text-left font-medium">Models</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <Fragment key={r.traceId}>
              <tr
                onClick={() => setOpen(o => (o === r.traceId ? null : r.traceId))}
                className={`cursor-pointer border-b border-[var(--color-border)]/50 hover:bg-white/5 ${r.errors > 0 ? 'text-[var(--color-red)]' : ''}`}
              >
                <td className="px-3 py-2 font-mono text-xs text-[var(--color-accent)]">
                  #{i + 1} <span className="text-[var(--color-muted)]">· {new Date(r.startMs).toLocaleTimeString()}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMs(r.durationMs)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <div className="flex items-center justify-end gap-1.5">
                    <div className="h-3 w-16 overflow-hidden rounded bg-[var(--color-bg)]">
                      <div className="h-full bg-[var(--color-accent)]/40" style={{ width: `${maxSpans ? (r.spans / maxSpans) * 100 : 0}%` }} />
                    </div>
                    <span>{r.spans}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{r.llmCalls}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.toolCount}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--color-muted)]">
                  {fmtNum(r.inputTokens)}
                  {r.cacheReadTokens > 0 && <span className="ml-1 text-xs text-[var(--color-yellow)]" title="cache-read">↳{fmtNum(r.cacheReadTokens)}</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.outputTokens)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.ttftMs ? fmtMs(r.ttftMs) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.errors > 0 ? <span className="text-[var(--color-red)]">{r.errors}</span> : '—'}</td>
                <td className="px-3 py-2 text-left">
                  <div className="flex flex-wrap gap-1">
                    {Array.from(r.models).slice(0, 2).map(m => <Tag key={m} color="#58a6ff">{cleanModel(m)}</Tag>)}
                    {r.models.size > 2 && <span className="text-xs text-[var(--color-muted)]">+{r.models.size - 2}</span>}
                  </div>
                </td>
              </tr>
              {open === r.traceId && (
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg)]/40">
                  <td colSpan={10} className="px-3 py-2">
                    <TurnSpanList trace={traces.find(t => t.traceID === r.traceId)!} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TurnSpanList({ trace }: { trace: SessionTrace }) {
  const sorted = [...trace.spans].sort((a, b) => a.startMs - b.startMs)
  return (
    <div className="space-y-1 text-xs">
      {sorted.map((s, i) => {
        const isErr = (s.name === 'claude_code.llm_request' || s.name === 'claude_code.tool.execution') && (s.attributes.success === false || s.attributes.error)
        return (
          <div key={i} className="flex items-center gap-2 border-l-2 pl-2" style={{ borderColor: s.name.includes('llm') ? '#58a6ff' : s.name.includes('tool') ? '#3fb950' : '#8b949e' }}>
            <span className="w-44 truncate text-[var(--color-muted)]" title={s.name}>{s.name.replace('claude_code.', '')}</span>
            <span className="font-mono">{s.attributes.tool_name || (s.attributes.model ? cleanModel(String(s.attributes.model)) : '') || '—'}</span>
            <span className="ml-auto font-mono text-[var(--color-muted)]">{fmtMs(s.durMs)}</span>
            {isErr && <AlertTriangle size={11} className="text-[var(--color-red)]" />}
          </div>
        )
      })}
    </div>
  )
}