import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { EmptyState } from '@/components/ui'
import { fmtNum, fmtUSD, cleanModel, TOKEN_COLORS, toolColor } from '@/lib/api'
import type { PromSeries } from '@/lib/types'

interface ToolDatum { name: string; value: number }

const AXIS_LABEL = { color: '#8b949e', fontSize: 10 }
const SPLIT_LINE = { lineStyle: { color: '#30363d' } }

function baseGrid(left = 60, right = 20, top = 10, bottom = 30) {
  return { left, right, top, bottom }
}

// ── Token flow over time (stacked area by type) ───────────────────────────────
export function TokenFlowChart({ data, height = 300 }: { data: PromSeries[]; height?: number }) {
  const option = useMemo(() => {
    const types: (keyof typeof TOKEN_COLORS)[] = ['input', 'output', 'cacheRead', 'cacheCreation']
    const series = types.map(type => {
      const match = data.find(d => d.metric?.type === type)
      return {
        name: type, type: 'line', stack: 'tokens', areaStyle: { opacity: 0.3 },
        lineStyle: { width: 1 }, symbol: 'none', smooth: true,
        data: match?.values?.map(v => [v[0] * 1000, parseFloat(v[1])]) ?? [],
        color: TOKEN_COLORS[type],
      }
    })
    return {
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, textStyle: { color: '#8b949e', fontSize: 11 } },
      grid: baseGrid(60, 20, 10, 30),
      xAxis: { type: 'time', axisLabel: AXIS_LABEL },
      yAxis: { type: 'value', axisLabel: { ...AXIS_LABEL, formatter: fmtNum }, splitLine: SPLIT_LINE },
      series,
    }
  }, [data])
  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'canvas' }} />
}

// ── Cost over time by model (stacked area) ───────────────────────────────────
export function CostByModelChart({ data, height = 260 }: { data: PromSeries[]; height?: number }) {
  const option = useMemo(() => {
    const palette = ['#58a6ff', '#3fb950', '#eda100', '#a371f7', '#db6d28', '#e87ba4', '#1baf7a', '#2a78d6']
    const series = data.map((d, i) => ({
      name: cleanModel(d.metric?.model ?? '?'), type: 'line', stack: 'cost',
      areaStyle: { opacity: 0.3 }, lineStyle: { width: 1 }, symbol: 'none',
      data: d.values?.map(v => [v[0] * 1000, parseFloat(v[1])]) ?? [],
      color: palette[i % palette.length],
    }))
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => fmtUSD(v) },
      legend: {
        orient: 'vertical',
        right: 4,
        top: 10,
        type: 'scroll',
        textStyle: { color: '#8b949e', fontSize: 10, width: 110, overflow: 'truncate' },
        tooltip: { show: true },
      },
      grid: baseGrid(50, 130, 10, 30),
      xAxis: { type: 'time', axisLabel: AXIS_LABEL },
      yAxis: { type: 'value', axisLabel: { ...AXIS_LABEL, formatter: (v: number) => '$' + fmtNum(v) }, splitLine: SPLIT_LINE },
      series,
    }
  }, [data])
  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'canvas' }} />
}

// ── Model mix donut ──────────────────────────────────────────────────────────
export function ModelDonut({ data, height = 260 }: { data: PromSeries[]; height?: number }) {
  const option = useMemo(() => {
    const items = data.map(d => ({
      name: cleanModel(d.metric?.model ?? 'unknown'),
      value: parseFloat(d.value?.[1] ?? '0'),
    })).filter(d => d.value > 0).sort((a, b) => b.value - a.value)
    return {
      tooltip: { trigger: 'item', formatter: (p: { name: string; value: number; percent: number }) => `${p.name}<br/>${fmtNum(p.value)} (${p.percent}%)` },
      legend: {
        orient: 'vertical',
        type: 'scroll',
        right: 4,
        top: 'middle',
        textStyle: { color: '#8b949e', fontSize: 10 },
        formatter: (name: string) => name.length > 18 ? `${name.slice(0, 18)}…` : name,
      },
      series: [{
        type: 'pie',
        radius: ['42%', '70%'],
        center: ['36%', '52%'],
        label: {
          show: items.length <= 5,
          color: '#8b949e',
          fontSize: 10,
          formatter: '{b}\n{d}%',
          overflow: 'truncate',
          width: 90,
        },
        labelLine: { show: items.length <= 5, length: 8, length2: 8 },
        avoidLabelOverlap: true,
        data: items,
      }],
    }
  }, [data])
  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'canvas' }} />
}

// ── Session starts (stacked bar by start_type) ───────────────────────────────
const START_COLORS: Record<string, string> = { fresh: '#2a78d6', resume: '#eb6834', continue: '#eda100' }
const START_TYPES = ['fresh', 'resume', 'continue']

export function SessionStartsChart({ data, height = 200 }: { data: PromSeries[]; height?: number }) {
  const hasValues = data.some(d => d.values && d.values.length > 0)
  const option = useMemo(() => {
    const series = START_TYPES.map(type => {
      const match = data.find(d => d.metric?.start_type === type)
      return {
        name: type, type: 'bar', stack: 'starts', barWidth: '80%',
        data: match?.values?.map(v => [v[0] * 1000, parseFloat(v[1])]) ?? [],
        color: START_COLORS[type],
      }
    })
    return {
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, textStyle: { color: '#8b949e', fontSize: 10 } },
      grid: baseGrid(40, 10, 10, 30),
      xAxis: { type: 'time', axisLabel: AXIS_LABEL },
      yAxis: { type: 'value', axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE },
      series,
    }
  }, [data])
  if (!hasValues) return <EmptyState>No session starts in this range</EmptyState>
  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'canvas' }} />
}

// ── Tool breakdown (horizontal bars: count / duration) ──────────────────────
// Source: Tempo tool spans aggregated client-side (passed in as {name,value}[]).
export function ToolBreakdownChart({ data, height = 260 }: { data: ToolDatum[]; height?: number }) {
  const option = useMemo(() => {
    const items = data.filter(d => d.value > 0).sort((a, b) => b.value - a.value).slice(0, 12)
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: baseGrid(90, 20, 5, 5),
      xAxis: { type: 'value', axisLabel: AXIS_LABEL },
      yAxis: { type: 'category', data: items.map(d => d.name).reverse(), axisLabel: AXIS_LABEL },
      series: [{
        type: 'bar',
        data: items.map(d => ({ value: d.value, itemStyle: { color: toolColor(d.name) } })).reverse(),
      }],
    }
  }, [data])
  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'canvas' }} />
}
