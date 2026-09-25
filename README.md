# Synthora

`Synthora` is a free, transparent, browser-first investment planning tool for conservative personal portfolios in Iran.

It is a mathematical decision-support engine. It does not use an AI model to predict markets, make promises, or generate opaque recommendations.

## Product behavior

- Persian right-to-left interface using Vazirmatn.
- English source code, comments, README, and technical documentation.
- A catalog separates priceable instruments from eight decision sleeves: liquidity, fixed income, gold, FX, Iran equity, global equity, crypto, and commodities. Recommendations still use the established fixed-income, gold, currency, and silver categories until other sleeves have adequate data or explicit versioned assumptions.
- All Iranian currency inputs, market values, calculations, and exports use تومان. Legacy browser data and legacy exports are converted once on import; gold and silver quantities remain grams.
- Salary, profile inputs, recommendation snapshots, and history remain in the browser's local storage.
- History and the personal portfolio ledger can be exported as a versioned JSON file. Imported recommendation records merge by timestamp; an imported portfolio ledger replaces the current one only after confirmation.
- A personal portfolio tracker has one primary dated transaction-entry form and a separate advanced ledger for transfers, corrections, and cash flows. Manual prices are price history only; they never create transactions.
- Portfolio values are calculated from holdings at a selected date and the best available immutable market-history point. Missing history remains missing rather than being backfilled.
- Corrections and tracking restarts are versioned and audited. The interface confirms before a change can affect historical portfolio calculations.
- A monthly recommendation based on salary, an optional age input, goal, horizon, risk tolerance, income stability, and emergency-fund status.
- Separate net-worth, investable-capital, and liquid-asset totals, with emergency-reserve coverage shown in months of essential expenses.
- New-contribution rebalancing: the tool shows target/current drift and directs the next contribution toward underweight supported categories instead of telling the user what to sell. Other sleeves are identified as excluded from that calculation.
- Standalone simulations and backtests use only their own form inputs, public market data, and configured model assumptions. They do not read the user's portfolio or saved recommendation history, and never write to either.
- Historical backtesting uses complete, continuously observed price periods only. Missing asset history makes the run unavailable and is reported; assumptions are never substituted as observed history. Available results include total invested, final value, annualized outcome, inflation-adjusted return, maximum drawdown, volatility, Sortino, and best/worst starting periods.
- Monte Carlo output with P10, P50, and P90 nominal and inflation-adjusted outcomes. The baseline is retained; EWMA and three-month block-bootstrap methods are gated by walk-forward validation.
- Simulations execute in a browser Web Worker, keeping the interface responsive and cancelling stale calculations on navigation.
- Clear labels when a calculation uses observed historical data versus model assumptions.

## Architecture

The project intentionally has no frontend framework or runtime dependency.

```text
index.html                 Persian UI shell
styles.css                 Responsive presentation
app.js                     Browser state, rendering, and local storage
src/engine.js              Pure planning, simulation, backtest, and Monte Carlo engine
src/analysis.js            Analysis task router shared by the Worker and tests
src/analysis.worker.js     Background simulation and backtest worker
src/market/catalog.js      Instrument and sleeve registries
src/portfolio.js           Portfolio ledger, versioning, valuation, and performance metrics
src/history.js             Versioned recommendation and portfolio export/import validation
functions/api/market.js    Cloudflare Pages Function for selected-asset quotes and quality aggregation
functions/api/history.js   Cloudflare Pages Function for observed historical data
functions/api/session.js   Signed, HttpOnly browser-session bootstrap
functions/api/inflation.js World Bank annual CPI inflation fallback
functions/api/migrations/ D1 session quota and platform-key usage tables
content/fa.json            Persian UI copy
tests/engine.test.js       Core model and portfolio tests
tests/financial-model.test.js Seeded quantitative regression tests
tests/history-api.test.js  History API and dated copper conversion tests
```

The calculation engine is isolated from the DOM and network layer. This keeps the model testable and makes it possible to replace the UI or data providers without changing the formulas.

## Portfolio accounting

The personal portfolio has three separate layers:

1. Market data is external, normalized, and treated as immutable input. A transaction can retain the market quote used when it was created, but the live market cache is never rewritten by portfolio edits.
2. The portfolio ledger stores opening balances, buys, sells, dividends, transfers, adjustments, deposits, and withdrawals. Each record has a date, creation timestamp, source, optional note, and audit reference.
3. The valuation engine replays the active portfolio version to any date, then calculates quantity multiplied by the market price available on that date. Manual تومان-denominated assets use unit price one because their entered quantity is already a value.

The primary form records an opening balance or purchase with its transaction time. Advanced corrections keep the original ledger and add a dated adjustment; a tracking restart closes the current version and creates a new baseline while preserving the previous version for audit.

The tracker reports current value, net invested amount, profit/loss, cash-flow-aware annualized return when it converges, inflation-adjusted value and return, allocation percentage, the tracking start date, and data-quality warnings. Portfolio charts begin at the first real ledger entry and show gaps when a historical price is unavailable.

## Market data design

The Pages Functions use independent public providers:

- Provider A: TGJU profile pages.
- Provider B: Bonbast public data request.
- Provider C: the public Navasan data mirror.
- Auxiliary metal source: global gold and silver reference prices converted to تومان with the aggregated dollar quote.

Each quote distinguishes direct from derived price, upstream observation time from retrieval time, and source provenance. Retrieval time is never presented as the market observation time. Binance BTCUSDT/ETHUSDT values are not converted as USD; they stay out of Toman aggregation until a verified USDT/TOMAN rate is available. Requests can select allow-listed assets, and conversion dependencies are fetched server-side. Providers run concurrently with bounded timeouts and fallback sources are called only when needed. The endpoint returns partial data when some sources fail.

A single source is shown with low confidence. Quotes are grouped by observation time before comparison; simultaneous values use median/MAD outlier screening and class-specific agreement thresholds. Conflicted prices are excluded from portfolio valuation. The response includes policy version, source counts, values, and response-time diagnostics; its initial interactive budget is 3.5 seconds.

The application does not replace a failed source with a stale cached quote or a fabricated value. The browser may display the last complete response as a clearly labelled cache fallback when the endpoint itself is unavailable.

Free public sources can be rate-limited, delayed, blocked, or change their response shape. The endpoint is therefore deliberately defensive and treats source coverage as part of the result.

## Model notes

### Allocation

The allocation engine uses transparent guardrails rather than price prediction. Short horizons, older age, unstable income, an incomplete emergency fund, and conservative risk tolerance increase the fixed-income weight. Longer horizons and higher risk tolerance allow a measured increase in hedge assets. The result is normalized to 100% and keeps silver as a small position.

### Future simulation

The simulation applies end-of-month contributions, explicit buy/sell costs, optional cadence- or threshold-based rebalancing, nominal return assumptions, and a separate inflation deflator. It shows nominal and today's-toman P10/P50/P90 values and labels data and assumptions. It is a planning scenario, not a forecast. The detailed calculation flow and its limits are documented in [the financial-model audit](docs/financial-model-audit.md).

### Historical backtest

The engine converts available provider history to monthly returns and tests every possible starting period for the selected horizon. Each reported period must have continuous observed data for every selected asset. If an asset history is absent or a monthly observation is missing, that period is excluded; if no complete period remains, the run is unavailable and identifies the missing assets. Model assumptions are not used to fill historical gaps.

The reported CAGR is a cash-flow-aware annualized outcome only when monthly IRR converges. Maximum drawdown uses the unitized return path, so contributions do not hide portfolio losses. Real drawdown uses the inflation-deflated unitized path; purchasing-power drawdown is separately measured against inflation-adjusted contributions.

### Monte Carlo

The simulation uses arithmetic monthly mean returns, sample volatility, and paired historical covariance when coverage is sufficient. Sparse correlations are blended toward disclosed asset-pair priors; missing or assumption-filled returns never enter historical covariance. It compares correlated lognormal Gaussian paths with three-month moving-block bootstrap paths when joint history is sufficient. P10/P50/P90 are simulated outcome percentiles, not confidence guarantees. Nominal and real values are shown separately, with real values deflated once by `(1 + annual inflation)^years`.

EWMA uses a 12-month half-life; moving-block bootstrap samples contiguous three-month blocks. The UI compares Gaussian and bootstrap results when eligible joint history is available. Fixed-income yield is modeled separately with mean-reverting (default), constant-current-yield, or configured-yield behavior; effective annual rates compound monthly as `(1 + y)^(1/12) - 1`. Sortino defaults to 0% MAR and is unavailable when observations or downside data are insufficient. Sharpe only appears when the fixed-income benchmark is explicitly selected. Goal projections and required-contribution search use the same assumptions and remain scenario outputs.

The default assumptions are intentionally visible in `src/engine.js` and are not presented as expected market returns. They exist so the tool remains usable when public historical data is incomplete.

## Local development

The static page can be opened directly, but `/api/market` requires the Pages Functions runtime.

```bash
npm install
npm run fix
npm run format:check
npm run lint
npm run check
npx wrangler pages dev . --compatibility-date=2026-09-18
```

Open the local URL printed by Wrangler.

## Deploy with Cloudflare Pages and GitHub

Cloudflare Pages Functions run server-side code at the edge, so the static page and `/api/*` endpoints can be deployed from one repository. Follow the [market API setup guide](docs/cloudflare-market-api.md) to configure the signed session, D1 quotas, and provider secrets. See the official [Cloudflare Pages Functions documentation](https://developers.cloudflare.com/pages/functions/).

1. Open **Workers & Pages** in Cloudflare.
2. Choose **Create application** and select **Pages**.
3. Connect `tahamoeini/invest-consult`.
4. Set the production branch to `main`.
5. Use these build settings:
   - Framework preset: `None`
   - Root directory: empty
   - Build command: `npm run format:check && npm run lint && npm test && npm run check`
   - Build output directory: `.`
6. Deploy.
7. Test the function:

```text
https://YOUR-PAGES-DOMAIN.pages.dev/api/market
```

The response should contain `updatedAt`, `assets`, `funds`, `history`, `diagnostics`, and `sources`. First visit must obtain a signed `/api/session` cookie. If the D1 binding or signing secret is missing, the API returns a configuration error instead of serving unmetered provider calls.

If the dashboard requires a non-empty build command, use `npm run format:check && npm run lint && npm test && npm run check`. Do not put `wrangler pages deploy` inside the Pages build command.

## Verification checklist

```bash
npm test
npm run check
node -e "JSON.parse(require('fs').readFileSync('content/fa.json', 'utf8')); console.log('content/fa.json is valid JSON')"
```

Before publishing, also verify:

- `/api/market` returns no fabricated values when one or more providers fail.
- Provider count and median source values are visible in the JSON response.
- Salary and local history are not present in any network request.
- Exported history can be imported into an empty browser and duplicate timestamps are not duplicated.
- The UI remains usable on a narrow mobile viewport.
- A partial historical response is excluded from backtest results and model-based future estimates are labelled as such.

## Limitations

This project is educational planning software, not financial advice, a broker statement, a fund NAV, or a guarantee of return. It does not model taxes, product fees, bid-ask spreads, liquidity constraints, purchase minimums, settlement delays, or every instrument available in Iran. Review those factors before acting.
