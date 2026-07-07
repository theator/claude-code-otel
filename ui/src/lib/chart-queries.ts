import { promQuery, promRange } from './api'
import type { PromSeries } from './types'

export async function fetchTokenFlow(start: number, end: number, step: number): Promise<PromSeries[]> {
  return promRange(`sum by(type)(rate(claude_code_token_usage_tokens_total[5m])) * ${step}`, start, end, step)
}

export async function fetchCostByModel(start: number, end: number, step: number): Promise<PromSeries[]> {
  return promRange(`sum by(model)(rate(claude_code_cost_usage_USD_total[5m])) * ${step}`, start, end, step)
}

export async function fetchModelDonut(selector: string): Promise<PromSeries[]> {
  return promQuery(`sum by(model)(increase(claude_code_token_usage_tokens_total[${selector}]))`)
}

export async function fetchSessionStarts(start: number, end: number, step: number): Promise<PromSeries[]> {
  return promRange(`sum by(start_type)(rate(claude_code_session_count_total[5m])) * ${step}`, start, end, step)
}
