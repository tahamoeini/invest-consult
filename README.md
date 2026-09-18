# invest-consult

`invest-consult` is a free, transparent, browser-first investment planning tool for conservative personal portfolios in Iran.

It is a mathematical decision-support engine. It does not use an AI model to predict markets, make promises, or generate opaque recommendations.

## Product behavior

- Persian right-to-left interface using Vazirmatn.
- English source code, comments, README, and technical documentation.
- Generic asset categories: fixed income, gold, currency, silver, stocks, cash, and other assets.
- Salary, profile inputs, recommendation snapshots, and history remain in the browser's local storage.
- History and the personal portfolio ledger can be exported as a versioned JSON file. Imported recommendation records merge by timestamp; an imported portfolio ledger replaces the current one only after confirmation.
- A personal portfolio tracker supports a simple current-balance entry and an advanced transaction ledger. It never stores only a mutable current amount.
- Portfolio values are calculated from holdings at a selected date and the best available immutable market-history point. Missing history remains missing rather than being backfilled.
- Corrections and tracking restarts are versioned and audited. The interface confirms before a change can affect historical portfolio calculations.
- A monthly recommendation based on salary, age, goal, horizon, risk tolerance, income stability, and emergency-fund status.
- New-contribution rebalancing: the tool directs the next contribution toward underweight categories instead of telling the user what to sell.
- A deterministic plan simulation with contribution growth, inflation adjustment, allocation, and rebalancing.
- Historical backtesting with total invested, final value, CAGR-style annualized outcome, inflation-adjusted return, maximum drawdown, and best/worst starting periods.
- Monte Carlo output with P10, P50, and P90 nominal and inflation-adjusted outcomes.
- Clear labels when a calculation uses observed historical data versus model assumptions.

## Architecture

The project intentionally has no frontend framework or runtime dependency.

```text
index.html                 Persian UI shell
styles.css                 Responsive presentation
app.js                     Browser state, rendering, and local storage
src/engine.js              Pure planning, simulation, backtest, and Monte Carlo engine
src/portfolio.js           Portfolio ledger, versioning, valuation, and performance metrics
src/history.js             Versioned recommendation and portfolio export/import validation
functions/api/market.js    Cloudflare Pages Function for live data aggregation
content/fa.json            Persian UI copy
tests/engine.test.js       Node built-in test suite
```

The calculation engine is isolated from the DOM and network layer. This keeps the model testable and makes it possible to replace the UI or data providers without changing the formulas.

## Portfolio accounting

The personal portfolio has three separate layers:

1. Market data is external, normalized, and treated as immutable input. A transaction can retain the market quote used when it was created, but the live market cache is never rewritten by portfolio edits.
2. The portfolio ledger stores opening balances, buys, sells, dividends, transfers, adjustments, deposits, and withdrawals. Each record has a date, creation timestamp, source, optional note, and audit reference.
3. The valuation engine replays the active portfolio version to any date, then calculates quantity multiplied by the market price available on that date. Manual IRR-denominated assets use unit price one because their entered quantity is already a value.

Simple mode creates opening-balance transactions. When an existing simple balance changes, the user chooses a real purchase/sale, a correction, or a new tracking baseline. A correction keeps the original ledger and adds a dated adjustment; a restart closes the current version and creates a new baseline while preserving the previous version for audit.

The tracker reports current value, net invested amount, profit/loss, cash-flow-aware annualized return when it converges, inflation-adjusted value and return, allocation percentage, the tracking start date, and data-quality warnings. Portfolio charts begin at the first real ledger entry and show gaps when a historical price is unavailable.

## Market data design

The Pages Function uses independent public providers:

- Provider A: TGJU profile pages.
- Provider B: Bonbast public data request.
- Provider C: the public Navasan data mirror.
- Auxiliary metal source: global gold and silver reference prices converted to IRR with the aggregated dollar quote.

Each quote is normalized to an asset, price, source, timestamp, and optional daily change. Invalid, unavailable, or failed quotes are dropped. If at least one valid quote remains, the displayed price is the median of the valid quotes. The endpoint returns provider diagnostics, source counts, source values, and provenance for inspection.

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

The simulation uses return means and volatility estimated from available monthly history where coverage is sufficient. It falls back to explicit conservative assumptions for sparse series. The default run uses 2,000 paths and can be changed to 1,000, 5,000, or 10,000 in the interface. P10, P50, and P90 are percentile summaries, not confidence guarantees.

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
