import { useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { useQuery } from '@tanstack/react-query'
import { promQuery, cleanModel, fmtNum, fmtUSD } from '@/lib/api'
import { useTimeRange, rangeSelector } from '@/lib/time'
import { Card, CardTitle, Spinner, ErrorState, EmptyState } from '@/components/ui'
import { cn } from '@/lib/cn'

type Metric = 'tokens' | 'cost' | 'cache'

const METRIC_TOGGLE: { key: Metric; label: string }[] = [
  { key: 'tokens', label: 'Tokens' },
  { key: 'cost', label: 'Cost' },
  { key: 'cache', label: 'Cache read' },
]

interface SunburstNode {
  name: string
  value: number
  children?: SunburstNode[]
  itemStyle?: { color?: string; borderColor?: string; borderWidth?: number }
}

const PALETTE = [
  '#58a6ff', '#3fb950', '#eda100', '#a371f7', '#db6d28', '#e87ba4',
  '#1baf7a', '#2a78d6', '#f85149', '#d29922', '#79c0ff', '#56d364',
  '#ffa657', '#d2a8ff', '#ff7b72', '#ff9ece', '#39c5cf', '#6ca4f7',
  '#aff5b4', '#ffdcd7', '#8b949e', '#6e7681',
]

function colorFor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash << 5) - hash + name.charCodeAt(i)
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

function label(v: string | undefined, fallback = '(none)'): string {
  const s = (v ?? '').trim()
  return s || fallback
}

function fmtVal(v: number, metric: Metric): string {
  return metric === 'cost' ? fmtUSD(v) : fmtNum(v)
}

async function loadAttribution(
  metric: Metric,
  selector: string,
  sessionId?: string,
): Promise<{ tree: SunburstNode[]; metric: Metric }> {
  const sel = `{session_id!=""${sessionId ? `,session_id="${sessionId}"` : ''}}[${selector}]`
  const metricExpr =
    metric === 'cost' ? 'claude_code_cost_usage_USD_total'
      : metric === 'cache' ? 'claude_code_token_usage_tokens_total{type="cacheRead"}'
        : 'claude_code_token_usage_tokens_total'

  const [bySourceModel, byModelAgent] = await Promise.all([
    promQuery(`sum by(query_source,model)(increase(${metricExpr}${sel}))`),
    promQuery(`sum by(model,agent_name)(increase(${metricExpr}${sel}))`),
  ])

  // model -> source -> value
  const sourceShareByModel = new Map<string, Map<string, number>>()
  const sourceNames = new Set<string>()
  const modelNames = new Set<string>()
  for (const r of bySourceModel) {
    const source = label(r.metric.query_source, 'main')
    const model = label(cleanModel(r.metric.model), '?')
    const value = parseFloat(r.value?.[1] ?? '0')
    if (value <= 0) continue
    sourceNames.add(source)
    modelNames.add(model)
    if (!sourceShareByModel.has(model)) sourceShareByModel.set(model, new Map())
    const share = sourceShareByModel.get(model)!
    share.set(source, (share.get(source) ?? 0) + value)
  }

  // model -> agent -> value
  const agentShareByModel = new Map<string, Map<string, number>>()
  for (const r of byModelAgent) {
    const model = label(cleanModel(r.metric.model), '?')
    const agent = label(r.metric.agent_name, 'main loop')
    const value = parseFloat(r.value?.[1] ?? '0')
    if (value <= 0) continue
    if (!agentShareByModel.has(model)) agentShareByModel.set(model, new Map())
    const share = agentShareByModel.get(model)!
    share.set(agent, (share.get(agent) ?? 0) + value)
  }

  // Build a 3-level sunburst: source -> model -> agent.
  // The agent query has no query_source dimension, so we distribute each
  // model's agent flows proportionally by the source share of that model.
  const tree: SunburstNode[] = []
  for (const source of Array.from(sourceNames).sort()) {
    const modelChildren: SunburstNode[] = []
    for (const model of Array.from(modelNames).sort()) {
      const sourceMap = sourceShareByModel.get(model)
      if (!sourceMap) continue
      const srcValue = sourceMap.get(source) ?? 0
      if (srcValue <= 0) continue

      const modelTotal = Array.from(sourceMap.values()).reduce((a, b) => a + b, 0)
      const agents = agentShareByModel.get(model)
      const agentChildren: SunburstNode[] = []

      if (agents && modelTotal > 0) {
        for (const [agent, agentTotal] of agents) {
          const allocated = agentTotal * (srcValue / modelTotal)
          if (allocated > 0) agentChildren.push({ name: agent, value: allocated })
        }
      }

      if (agentChildren.length === 0) {
        modelChildren.push({ name: model, value: srcValue })
      } else {
        modelChildren.push({ name: model, value: srcValue, children: agentChildren })
      }
    }
    if (modelChildren.length > 0) {
      tree.push({
        name: source,
        value: modelChildren.reduce((a, b) => a + b.value, 0),
        children: modelChildren,
      })
    }
  }

  return { tree, metric }
}

function colorize(node: SunburstNode, depth = 0): SunburstNode {
  const colored: SunburstNode = {
    name: node.name,
    value: node.value,
    itemStyle: { color: depth === 0 ? colorFor(node.name) : undefined, borderColor: '#0d1117', borderWidth: 1.5 },
    children: node.children?.map(c => colorize(c, depth + 1)),
  }
  return colored
}

export function AttributionChart({ sessionId }: { sessionId?: string } = {}) {
  const { range } = useTimeRange()
  const selector = rangeSelector(range)
  const [metric, setMetric] = useState<Metric>('tokens')
  const { data, isLoading, error } = useQuery({
    queryKey: ['attribution', metric, range.start, range.end, sessionId ?? 'all'],
    queryFn: () => loadAttribution(metric, selector, sessionId),
    staleTime: 30_000,
  })

  const option = useMemo(() => {
    const tree = (data?.tree ?? []).map(n => colorize(n))
    return {
      tooltip: {
        trigger: 'item',
        formatter: (p: { treePathInfo?: { name: string; value: number }[]; value: number }) => {
          const path = (p.treePathInfo ?? []).map(i => i.name).join(' → ')
          const rootValue = p.treePathInfo?.[0]?.value ?? p.value
          const pct = rootValue ? ((p.value / rootValue) * 100).toFixed(1) : '0.0'
          return `${path}<br/><b>${fmtVal(p.value, metric)}</b> (${pct}%)`
        },
      },
      series: [{
        type: 'sunburst',
        data: tree,
        radius: [0, '95%'],
        label: {
          rotate: 'radial',
          color: '#c9d1d9',
          fontSize: 10,
          minAngle: 4,
        },
        levels: [
          {},
          {
            r0: '0%',
            r: '32%',
            itemStyle: { borderWidth: 2 },
            label: { rotate: 'tangential', fontWeight: 'bold' },
          },
          {
            r0: '32%',
            r: '62%',
            label: { align: 'right' },
          },
          {
            r0: '62%',
            r: '95%',
            label: { position: 'outside', padding: 3, silent: false, color: '#8b949e' },
          },
        ],
      }],
    }
  }, [data, metric])

  return (
    <Card>
      <CardTitle right={
        <div className="flex rounded border border-[var(--color-border)] text-xs">
          {METRIC_TOGGLE.map(m => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={cn(
                'px-2.5 py-1 transition',
                metric === m.key
                  ? 'bg-[var(--color-accent)] text-black'
                  : 'text-[var(--color-text)] hover:bg-white/5',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      }>
        Token Attribution — where tokens go
      </CardTitle>
      {error ? <ErrorState message={(error as Error).message} /> :
        isLoading ? <Spinner /> :
          !data || data.tree.length === 0 ? <EmptyState>No attribution data in {range.label}</EmptyState> :
            <ReactECharts option={option} style={{ height: 380 }} opts={{ renderer: 'canvas' }} />}
      <div className="mt-2 text-xs text-[var(--color-muted)]">
        Sunburst: inner ring = query source, middle = model, outer = agent. Hover for values.
      </div>
    </Card>
  )
}
