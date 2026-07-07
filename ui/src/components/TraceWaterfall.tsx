import { useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { AlertCircle } from 'lucide-react'
import { spanColor, cleanModel, fmtMs } from '@/lib/api'
import type { SessionTrace } from '@/lib/traces'

const SPAN_TYPES = [
  'claude_code.interaction',
  'claude_code.llm_request',
  'claude_code.tool',
  'claude_code.tool.execution',
  'claude_code.tool.blocked_on_user',
]

interface Props {
  traces: SessionTrace[]
}

export function TraceWaterfall({ traces }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set(['claude_code.interaction']))
  const [selected, setSelected] = useState<string | null>(null)

  const option = useMemo(() => {
    const categories: string[] = []
    const seriesData: Array<{ value: [number, number, number, string]; itemStyle: { color: string; borderColor?: string }; spanType: string }> = []
    const erroredTraceIds = new Set<string>()

    traces.forEach((td, i) => {
      const base = td.startMs
      categories.push(td.traceID.slice(0, 8))
      for (const s of td.spans) {
        if (hidden.has(s.name)) continue
        const isErr = s.name === 'claude_code.llm_request' && (s.attributes.success === false || (s.attributes.status_code && String(s.attributes.status_code) !== '200'))
          || s.name === 'claude_code.tool.execution' && (s.attributes.success === false || s.attributes.error)
        if (isErr) erroredTraceIds.add(td.traceID)
        const label = s.attributes.tool_name || s.attributes.model || ''
        seriesData.push({
          value: [i, s.startMs - base, s.endMs - base, String(label)],
          itemStyle: { color: spanColor(s.name), borderColor: isErr ? '#f85149' : 'transparent' },
          spanType: s.name,
        })
      }
    })

    const seriesByType = new Map<string, typeof seriesData>()
    for (const d of seriesData) {
      const arr = seriesByType.get(d.spanType) ?? []
      arr.push(d)
      seriesByType.set(d.spanType, arr)
    }

    return {
      tooltip: {
        trigger: 'item',
        formatter: (p: { value: [number, number, number, string] }) => {
          const [idx, start, end, label] = p.value
          const td = traces[idx]
          const span = td?.spans.find(s => s.startMs - td.startMs === start && (s.endMs - s.startMs) === (end - start))
          const dur = end - start
          const lines = [`<b>${span?.name ?? ''}</b>`, label ? label : '']
          if (span?.attributes.model) lines.push(`model: ${cleanModel(String(span.attributes.model))}`)
          if (span?.attributes.input_tokens) lines.push(`in: ${span.attributes.input_tokens} / out: ${span.attributes.output_tokens}`)
          if (span?.attributes.error) lines.push(`<span style="color:#f85149">${span.attributes.error}</span>`)
          lines.push(`${fmtMs(dur)}`)
          return lines.filter(Boolean).join('<br/>')
        },
      },
      grid: { left: 80, right: 20, top: 10, bottom: 35 },
      xAxis: { type: 'value', name: 'ms', nameTextStyle: { color: '#8b949e', fontSize: 10 }, axisLabel: { color: '#8b949e', fontSize: 10, formatter: (v: number) => fmtMs(v) } },
      yAxis: {
        type: 'category', data: categories,
        axisLabel: {
          color: (val: string) => erroredTraceIds.has(traces.find(t => t.traceID.slice(0, 8) === val)?.traceID ?? '') ? '#f85149' : '#8b949e',
          fontSize: 10, fontFamily: 'monospace',
        },
      },
      series: SPAN_TYPES.filter(t => !hidden.has(t)).map(name => ({
        name, type: 'custom',
        renderItem: (params: { value: (i: number) => number; coord: (p: number[]) => number[]; size: (p: number[]) => number[]; style: () => unknown }) => {
          const idx = params.value(0)
          const start = params.value(1)
          const end = params.value(2)
          const y = params.coord([0, idx])[1]
          const x1 = params.coord([start, 0])[0]
          const x2 = params.coord([end, 0])[0]
          const height = Math.min(params.size([0, 1])[1] * 0.5, 14)
          return {
            type: 'rect',
            shape: { x: x1, y: y - height / 2, width: Math.max(x2 - x1, 2), height },
            style: params.style(),
          }
        },
        data: seriesByType.get(name) ?? [],
        encode: { x: [1, 2], y: 0 },
      })),
    }
  }, [traces, hidden])

  if (traces.length === 0) return null

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
        {SPAN_TYPES.map(t => (
          <button
            key={t}
            onClick={() => setHidden(h => { const n = new Set(h); if (n.has(t)) n.delete(t); else n.add(t); return n })}
            className="flex items-center gap-1.5"
            style={{ opacity: hidden.has(t) ? 0.4 : 1 }}
          >
            <span className="h-3 w-3 rounded-sm" style={{ background: spanColor(t) }} />
            <span className="text-[var(--color-muted)]">{t.replace('claude_code.', '')}</span>
          </button>
        ))}
      </div>
      <ReactECharts
        option={option}
        style={{ height: Math.max(280, traces.length * 26 + 60) }}
        opts={{ renderer: 'canvas' }}
        onEvents={{ click: (e: { value: [number, number, number, string] }) => setSelected(traces[e.value[0]]?.traceID ?? null) }}
      />
      {selected && <SelectedTraceDrawer trace={traces.find(t => t.traceID === selected)!} onClose={() => setSelected(null)} />}
    </div>
  )
}

function SelectedTraceDrawer({ trace, onClose }: { trace: SessionTrace; onClose: () => void }) {
  return (
    <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-xs text-[var(--color-accent)]">{trace.traceID}</span>
        <button onClick={onClose} className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]">close ✕</button>
      </div>
      <div className="space-y-1 text-xs">
        {trace.spans.map((s, i) => (
          <div key={i} className="flex items-center gap-2 border-l-2 pl-2" style={{ borderColor: spanColor(s.name) }}>
            <span className="w-44 text-[var(--color-muted)]">{s.name.replace('claude_code.', '')}</span>
            <span className="font-mono">{s.attributes.tool_name || s.attributes.model || cleanModel(String(s.attributes.model ?? '')) || '—'}</span>
            <span className="ml-auto font-mono text-[var(--color-muted)]">{fmtMs(s.durMs)}</span>
            {s.attributes.error && <AlertCircle size={12} className="text-[var(--color-red)]" />}
          </div>
        ))}
      </div>
    </div>
  )
}