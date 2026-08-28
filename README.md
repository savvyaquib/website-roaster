# Website Roaster

Analyzes a single public web page and produces a structured, evidence-based
quality report — performance, SEO, accessibility, mobile, security, content and
UX — plus prioritised recommendations and an optional humorous roast grounded in
what was actually observed.

**Status: Phase 0 (repository foundation).** The analysis pipeline is not built
yet. See `docs/IMPLEMENTATION.md` for what exists and what comes next.

---

## Requirements

- Node.js 20 or newer (developed on 24)
- npm

## Getting started

```bash
npm install
cp .env.example .env.local   # optional; every variable has a default today
npm run dev
```

Open http://localhost:3000.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run lint:fix` | ESLint with autofix |
| `npm run format` | Prettier, write |
| `npm run format:check` | Prettier, verify only |
| `npm test` | Vitest, single run |
| `npm run test:watch` | Vitest, watch mode |
| `npm run verify` | typecheck + lint + format:check + test |

Run `npm run verify` before opening a pull request.

## Project layout

```text
app/     Next.js App Router — UI and route handlers only
lib/     Framework-independent application logic
  config/         validated environment
  observability/  structured logging
  types/          shared domain types
docs/    Specification, scoring model, decisions
```

`lib/` never imports from `app/`, and never imports Next.js runtime APIs. That
boundary is what keeps the analysis pipeline testable in isolation. See ADR-027.

## Configuration

Environment variables are declared, typed and validated in one place:
`lib/config/env.ts`. Application code reads `getServerEnv()` rather than
`process.env`.

`.env.example` documents every variable. Secrets are server-side only and must
never be given a `NEXT_PUBLIC_` prefix, which would inline them into the client
bundle (ADR-018).

## Testing

Vitest, with unit tests colocated beside the code they cover as `*.test.ts`.

```bash
npm test
```

## Documentation

| Document | Contents |
| --- | --- |
| `CLAUDE.md` | Engineering rules and working process |
| `docs/IMPLEMENTATION.md` | Phase plan and current status — the implementation source of truth |
| `docs/ARCHITECTURE.md` | Runtime, pipeline, module boundaries, security boundaries |
| `docs/SCORING.md` | Weights, grades, and how findings become a score |
| `docs/DECISIONS.md` | Architecture decision records |

## Deployment

Website Roaster requires a **long-running Node.js server**. It is not
deployable to a short-lived serverless runtime: the pipeline drives a real
browser and runs Lighthouse, which needs a Chromium binary and more execution
time than those runtimes allow. See ADR-032.
