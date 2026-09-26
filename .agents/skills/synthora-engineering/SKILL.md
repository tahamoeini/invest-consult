---
name: synthora-engineering
description: Use when changing Synthora's financial planning or simulation logic, portfolio ledger and history, market-data routes, API security or persistence, or hosting architecture. Skip for copy-only and styling-only changes.
---

# Synthora engineering

Use this skill for changes that affect financial meaning, personal records, market-data quality, API boundaries, or hosting portability.

## Read the relevant project contract

- Start with README.md and docs/architecture-and-portability.md.
- For calculations or recommendations, read docs/financial-model-audit.md.
- For market providers, quote quality, or backtest inputs, read docs/market-data-and-forecasting.md.
- For API secrets, quotas, D1, or Cloudflare deployment, read docs/cloudflare-market-api.md and inspect the current functions/api/ code and every migration.
- For storage or sync proposals, read docs/data-persistence-and-sync-plan.md. It is a proposal; do not infer approval for accounts, uploads, retention policy, or cloud sync from its presence.

Trace the relevant flow from the browser form or API request through validation, normalized domain data, calculation or persistence, and rendered output. Check the existing tests and their fixtures before choosing where a change belongs.

## Keep financial meaning explicit

- Keep the model in تومان even when the UI displays another currency. A display conversion must not alter ledger inputs or saved model values.
- Preserve units, source identity, observation time, retrieval time, direct/derived status, and conversion dependencies through market-data normalization.
- Do not infer observedAt from retrieval time. Do not turn stale, missing, or conflicted prices into current valuation inputs.
- Keep missing periods missing. Backtests require continuous observed data; configured assumptions belong to future scenarios and must be labeled as assumptions.
- Keep model defaults and policy thresholds visible and intentional. Explain material changes and version them where existing model-version fields apply.
- Preserve append-only audit behavior, portfolio versions, import validation, legacy compatibility, and explicit confirmation before replacing user records.

## Keep personal data and credentials bounded

- Profile data, salary, portfolio records, and transaction notes stay in browser storage under the current product boundary. Never put them in market-data requests.
- Do not include provider credentials in URLs, logs, JSON exports, or shared responses. Keep platform keys in server-side secrets and user-supplied keys in the existing explicit header/storage flow.
- Do not weaken same-origin checks, signed-session validation, route limits, or provider budgets to make a test or deployment pass. Missing required security configuration should remain a visible failure.
- Review provider terms, caching, attribution, quotas, and redistribution rights before adding a provider or retaining its data.

## Keep the runtime replaceable

- Keep src/engine.js, src/portfolio.js, and shared normalization modules free of DOM, provider, storage, and Cloudflare APIs.
- Preserve the /api/* JSON contract and implement hosting-specific request handling at the API boundary.
- Cloudflare Pages Functions use context.env, the API_USAGE_DB D1 binding, and Cloudflare cf fetch options. Isolate those details; do not describe D1 or Pages Functions as portable unchanged.
- Any alternate host must provide durable session, quota, provider-budget, and cache behavior. Do not replace shared D1 state with an in-process map. A small single-instance server may use local durable storage only if its deployment limits are explicit.
- Add ordered SQL migrations for new D1 schema changes. Inspect migration history and deployment state; do not rewrite a migration that may have shipped.
- Do not introduce account sync, a second hosting runtime, or CI/CD as incidental cleanup.

## Use existing coverage

Use deterministic fixtures rather than live provider calls for routine checks. Relevant coverage is grouped in tests/engine.test.js, tests/financial-model.test.js, tests/market*.test.js, tests/history*.test.js, tests/analysis.test.js, and tests/helpers/api-context.js. When a new JavaScript module is added, check whether the explicit file list in npm run check needs updating.
