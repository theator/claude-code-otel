# Claude Code Telemetry UI

React + TypeScript + Vite dashboard for the local Claude Code telemetry stack.

The backends (Prometheus, Loki, Tempo, Phoenix) are expected to be running from the docker-compose setup in the project root. The browser requests data through a local CORS proxy on `http://localhost:8090`, which is provided by `proxy.py` in the project root.

## Available routes

- `/#/` — Overview: KPIs, token flow, cost by model, session attribution
- `/#/sessions` — Session list with sorting, filtering, CSV export, active-session toggle
- `/#/sessions/:id` — Session detail: trace waterfall, per-turn breakdown, tool calls, TTFT, errors

## Scripts

```bash
# Install dependencies
npm install

# Dev server with HMR
npm run dev

# Type-check + production build to dist/
npm run build

# Preview production build
npm run preview

# Lint (Oxlint)
npm run lint
```

## Project conventions

- Shared components live in `src/components/`
- Page views live in `src/views/`
- Shared utilities live in `src/lib/`
- Styling uses Tailwind 4 with the CSS variables defined in `src/index.css`
- Global state:
  - Time range / refresh interval: `src/lib/time.ts`
  - Router: `src/router.ts`
- PromQL queries, Tempo/Loki fetches, and formatting helpers are centralized in `src/lib/api.ts`; chart-specific queries live in `src/lib/chart-queries.ts`
