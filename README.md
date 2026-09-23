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
- A personal portfolio tracker supports a simple current-balance entry and an advanced transaction ledger. It never stores only a mutable current amount.
- Portfolio values are calculated from holdings at a selected date and the best available immutable market-history point. Missing history remains missing rather than being backfilled.
- Corrections and tracking restarts are versioned and audited. The interface confirms before a change can affect historical portfolio calculations.
- A monthly recommendation based on salary, an optional age input, goal, horizon, risk tolerance, income stability, and emergency-fund status.
- Separate net-worth, investable-capital, and liquid-asset totals, with emergency-reserve coverage shown in months of essential expenses.
- New-contribution rebalancing: the tool shows target/current drift and directs the next contribution toward underweight supported categories instead of telling the user what to sell. Other sleeves are identified as excluded from that calculation.
- A goal planner estimates success probability, P10/P50/P90 outcomes, projected inflation-adjusted target value, and required monthly contribution using the same simulation model.
- A deterministic plan simulation with contribution growth, inflation adjustment, allocation, and rebalancing.
- Historical backtesting with total invested, final value, CAGR-style annualized outcome, inflation-adjusted return, maximum drawdown, volatility, Sortino, and best/worst starting periods. Sharpe is in the advanced report and identifies its fixed-income reference rate.
- Monte Carlo output with P10, P50, and P90 nominal and inflation-adjusted outcomes. The baseline is retained; EWMA and three-month block-bootstrap methods are gated by walk-forward validation.
- Simulation and backtest execute lazily in a browser Web Worker, keeping the interface responsive and cancelling stale calculations on navigation or plan changes.
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
content/fa.json            Persian UI copy
tests/engine.test.js       Node built-in test suite
```

The calculation engine is isolated from the DOM and network layer. This keeps the model testable and makes it possible to replace the UI or data providers without changing the formulas.

## Portfolio accounting

The personal portfolio has three separate layers:

1. Market data is external, normalized, and treated as immutable input. A transaction can retain the market quote used when it was created, but the live market cache is never rewritten by portfolio edits.
2. The portfolio ledger stores opening balances, buys, sells, dividends, transfers, adjustments, deposits, and withdrawals. Each record has a date, creation timestamp, source, optional note, and audit reference.
3. The valuation engine replays the active portfolio version to any date, then calculates quantity multiplied by the market price available on that date. Manual تومان-denominated assets use unit price one because their entered quantity is already a value.

Simple mode creates opening-balance transactions. When an existing simple balance changes, the user chooses a real purchase/sale, a correction, or a new tracking baseline. A correction keeps the original ledger and adds a dated adjustment; a restart closes the current version and creates a new baseline while preserving the previous version for audit.

The tracker reports current value, net invested amount, profit/loss, cash-flow-aware annualized return when it converges, inflation-adjusted value and return, allocation percentage, the tracking start date, and data-quality warnings. Portfolio charts begin at the first real ledger entry and show gaps when a historical price is unavailable.

## Market data design

The Pages Function uses independent public providers:

- Provider A: TGJU profile pages.
- Provider B: Bonbast public data request.
- Provider C: the public Navasan data mirror.
- Auxiliary metal source: global gold and silver reference prices converted to تومان with the aggregated dollar quote.

Each quote distinguishes direct from derived price, upstream observation time from retrieval time, and source provenance. Retrieval time is never presented as the market observation time. Binance BTCUSDT/ETHUSDT values are not converted as USD; they stay out of Toman aggregation until a verified USDT/TOMAN rate is available. Requests can select allow-listed assets, and conversion dependencies are fetched server-side. Providers run concurrently with bounded timeouts and fallback sources are called only when needed. The endpoint returns partial data when some sources fail.

A single source is shown with low confidence. Two-source disagreement is marked conflicted until class-specific agreement thresholds are calibrated. Three or more sources use median/MAD outlier detection. Conflicted prices are excluded from portfolio valuation. The response includes policy version, source counts, values, and response-time diagnostics; its initial interactive budget is 3.5 seconds.

The application does not replace a failed source with a stale cached quote or a fabricated value. The browser may display the last complete response as a clearly labelled cache fallback when the endpoint itself is unavailable.

Free public sources can be rate-limited, delayed, blocked, or change their response shape. The endpoint is therefore deliberately defensive and treats source coverage as part of the result.

## Model notes

### Allocation

The allocation engine uses transparent guardrails rather than price prediction. Short horizons, older age, unstable income, an incomplete emergency fund, and conservative risk tolerance increase the fixed-income weight. Longer horizons and higher risk tolerance allow a measured increase in hedge assets. The result is normalized to 100% and keeps silver as a small position.

### Future simulation

The simulation applies monthly contributions, annual contribution growth, nominal annual return assumptions, optional rebalancing, and inflation deflation. It is a planning scenario, not a forecast.

### Historical backtest

The engine converts available provider history to monthly returns and tests every possible starting period for the selected horizon. If a public history is missing for an asset, the engine uses the configured model assumption for that asset and marks the result as estimated. This avoids presenting a partial history as a complete market record.

The reported CAGR is a cash-flow-aware annualized outcome when the internal monthly IRR converges; otherwise the engine uses a documented total-invested fallback. Maximum drawdown is calculated from the simulated portfolio value path.

### Monte Carlo

The simulation uses return means and volatility estimated from available monthly history where coverage is sufficient. It falls back to explicit versioned assumptions for sparse series. Covariance uses paired observed returns only; missing/imputed returns never enter covariance, and short samples shrink correlations toward zero. The default run uses 2,000 paths and can be changed to 1,000, 5,000, or 10,000 in the interface. P10, P50, and P90 are percentile summaries, not confidence guarantees.

EWMA uses a 12-month half-life; moving-block bootstrap samples contiguous three-month blocks. Both methods must pass a rolling 24-month-training, minimum-24-forecast walk-forward gate before the app selects them. Otherwise, the existing Gaussian Monte Carlo remains the baseline. Goal projections and required-contribution search use the same selected model and currently include only the four modeled planning categories.

The default assumptions are intentionally visible in `src/engine.js` and are not presented as expected market returns. They exist so the tool remains usable when public historical data is incomplete.

## Local development

The static page can be opened directly, but `/api/market` requires the Pages Functions runtime.

```bash
npm test
npm run check
npx wrangler pages dev . --compatibility-date=2026-09-18
```

Open the local URL printed by Wrangler.

## Deploy with Cloudflare Pages and GitHub

Cloudflare Pages Functions run server-side code at the edge, so the static page and `/api/market` can be deployed from one repository. See the official [Cloudflare Pages Functions documentation](https://developers.cloudflare.com/pages/functions/).

1. Open **Workers & Pages** in Cloudflare.
2. Choose **Create application** and select **Pages**.
3. Connect `tahamoeini/invest-consult`.
4. Set the production branch to `main`.
5. Use these build settings:
   - Framework preset: `None`
   - Root directory: empty
   - Build command: `npm test && npm run check`
   - Build output directory: `.`
6. Deploy.
7. Test the function:

```text
https://YOUR-PAGES-DOMAIN.pages.dev/api/market
```

The response should contain `updatedAt`, `assets`, `funds`, `history`, `diagnostics`, and `sources`.

If the dashboard requires a non-empty build command, use `npm test && npm run check`. Do not put `wrangler pages deploy` inside the Pages build command.

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
- A sparse historical response is labelled as estimated in the backtest and Monte Carlo sections.

## Limitations

This project is educational planning software, not financial advice, a broker statement, a fund NAV, or a guarantee of return. It does not model taxes, product fees, bid-ask spreads, liquidity constraints, purchase minimums, settlement delays, or every instrument available in Iran. Review those factors before acting.
