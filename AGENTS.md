# Claude Code Telemetry — Agent Notes

## What this project is

A local observability stack for Claude Code's OpenTelemetry export. It receives OTLP metrics/traces/logs from Claude Code, stores them in LGTM (Grafana, Loki, Tempo, Prometheus) plus Arize Phoenix, and provides dashboards to explore cost, tokens, sessions, tools, and trace waterfalls.

## Architecture

- `docker-compose.yml` — `grafana/otel-lgtm:latest` (LGTM) + `arizephoenix/phoenix:latest`
- `otelcol-config.yaml` — OpenTelemetry Collector config: delta metrics → cumulative, token attribute remapping to OpenInference, routing traces to Tempo + Phoenix, metrics to Prometheus, logs to Loki
- `proxy.py` — lightweight Python CORS proxy on `:8090`; bridges browser requests to Loki (`/loki/*`), Tempo (`/tempo/*`), and Phoenix (`/phoenix/*`)
- `dashboard.html` — standalone vanilla-JS dashboard (ECharts) that reads from the proxy
- `ui/` — newer React + TypeScript + Vite dashboard with Overview, Sessions, and Session Detail views
- `grafana-dashboards/` — Grafana dashboard JSON + provisioning config loaded into LGTM

## Ports

| Port | Service                                  |
| ---- | ---------------------------------------- |
| 3000 | Grafana UI                               |
| 4317 | OTLP gRPC                                |
| 4318 | OTLP HTTP                                |
| 9090 | Prometheus API                           |
| 3100 | Loki API                                 |
| 3200 | Tempo API                                |
| 6006 | Phoenix UI + OTLP HTTP trace ingestion   |
| 8090 | Local CORS proxy                         |

## How to run

1. Start the backends:

   ```bash
   docker compose up -d
   ```

2. Start the CORS proxy and open the legacy dashboard:

   ```bash
   ./start.sh
   ```

3. To run the React UI in dev mode:

   ```bash
   cd ui
   npm install
   npm run dev
   ```

4. To build the React UI:

   ```bash
   cd ui
   npm install
   npm run build  # output to ui/dist/
   ```

## UI code conventions

- React 19, TanStack Router + Query, ECharts via `echarts-for-react`, Tailwind 4
- Keep styling consistent with CSS variables `--color-bg`, `--color-card`, `--color-border`, `--color-text`, `--color-muted`, `--color-accent`, `--color-green`, `--color-yellow`, `--color-red`
- Put shared components in `ui/src/components/`, shared utilities in `ui/src/lib/`, and page-level views in `ui/src/views/`
- Keep PromQL queries in `ui/src/lib/api.ts`, `ui/src/lib/chart-queries.ts`, or the relevant view file; avoid hard-coding queries in components
- `ui/src/lib/time.ts` is the global time-range store; views consume it via `useTimeRange()`

## Tests / lint

- UI lint: `cd ui && npm run lint` (uses Oxlint)
- There are currently no automated tests

## Claude Code OpenTelemetry setup

For telemetry to flow in, Claude Code must be configured to export OTLP to `http://localhost:4318` (or `http://localhost:4317` for gRPC). The collector transforms and forwards the data.
