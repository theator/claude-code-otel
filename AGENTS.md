# Claude Code Telemetry — Agent Notes

## What this project is

A local observability stack for Claude Code's OpenTelemetry export. It receives OTLP metrics/traces/logs from Claude Code, stores them in Grafana LGTM (Loki, Tempo, Prometheus) plus Arize Phoenix, and ships a pre-provisioned Grafana dashboard to explore cost, tokens, sessions, tools, and trace waterfalls.

## Architecture

- `docker-compose.yml` — `grafana/otel-lgtm` (LGTM all-in-one) + `arizephoenix/phoenix` (LLM-native trace inspection). Images are pinned.
- `otelcol-config.yaml` — OpenTelemetry Collector config: converts Claude Code's delta metric counters to cumulative (Prometheus rejects delta sums), remaps flat token attributes onto the OpenInference `llm.token_count.*` names Phoenix expects, and fans traces out to Tempo + Phoenix.
- `grafana-dashboards/claude-code.json` — the dashboard, source of truth. Hot-reloads (Grafana re-reads every 10s).
- `grafana-dashboards/provisioning.yaml` — tells Grafana to load the dashboard.
- `settings.claude.example.json` — the telemetry `env` block to add to Claude Code.
- `setup.sh` — merges that block into `~/.claude/settings.json` (backs up first, never clobbers existing keys).
- `Makefile` — `make setup / up / down / restart / start / clean / ...`.

## Ports

| Port | Service                                  |
| ---- | ---------------------------------------- |
| 3000 | Grafana UI (dashboard)                   |
| 4317 | OTLP gRPC   (Claude Code → collector)    |
| 4318 | OTLP HTTP   (Claude Code → collector)    |
| 9090 | Prometheus API (debugging)               |
| 3100 | Loki API (debugging)                     |
| 3200 | Tempo API (debugging)                    |
| 6006 | Phoenix UI + OTLP HTTP trace ingestion   |

## How to run

```bash
make start        # configure Claude Code telemetry + start the stack
open http://localhost:3000
```

`make start` runs `make setup` (telemetry env) then `make up` (containers). Restart any open Claude Code sessions so they pick up the new settings.

## Editing the dashboard

The dashboard is provisioned from `grafana-dashboards/claude-code.json` and hot-reloads. Edit the JSON directly — it is the source of truth. Grafana's "Save dashboard" button won't persist to the file (provisioned dashboards are read-only from the UI). If a bind-mount cache goes stale and edits don't appear, `make restart`.

Query fundamentals:
- Metrics (cost/tokens/counters) → Prometheus (`claude_code_*` metrics).
- Structured log events (prompts, tool results, API errors, compaction) → Loki, filtered by `event_name=...`.
- Spans (interaction / llm_request / tool) → Tempo via TraceQL. Use `tableType=spans` to flatten a `select(span.attr)` into a real table column instead of a nested sub-frame. Requires `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`.

## Tests / lint

There are no automated tests. Validate the dashboard JSON with `python3 -m json.tool grafana-dashboards/claude-code.json` before committing.

## Claude Code OpenTelemetry setup

For telemetry to flow in, Claude Code must export OTLP to `http://localhost:4318` (HTTP) or `:4317` (gRPC). See `settings.claude.example.json` for the exact env block; `make setup` applies it. `OTEL_LOG_USER_PROMPTS=1` and `OTEL_LOG_TOOL_DETAILS=1` populate the prompt-text and shell-command columns — everything stays local.
