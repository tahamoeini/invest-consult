# Invest Consult — fintech dashboard audit

Branch: `feat/final-financial-dashboard`

## Audit scope

- Application shell, navigation, responsive behavior, and accessibility
- UI-to-engine data flow and state persistence
- Portfolio ledger, versioned history, currency migration, and import/export
- Market loading, cache fallback, missing-data behavior, and source diagnostics
- Planning, simulation, Monte Carlo, backtesting, and historical comparison
- Charts, empty/loading/error states, and misleading financial representations

## Resolved checklist

- [x] Dashboard is a command center rather than a landing-only page.
- [x] Summary cards distinguish no portfolio, incomplete valuation, and usable valuation.
- [x] Portfolio performance uses the existing ledger and `portfolioSeries`; no synthetic history is added.
- [x] Performance ranges support 1M, 6M, 1Y, and ALL.
- [x] Allocation shows actual versus target weights and a transparent imbalance threshold.
- [x] Health indicators are rule-based and display their reason; no artificial aggregate AI score is shown.
- [x] Monthly action center is sourced from the saved plan and points back to editable inputs.
- [x] Market snapshot shows value, daily change when available, freshness, and source confidence.
- [x] Market diagnostics remain available behind an advanced disclosure.
- [x] Investment planning is a two-column workspace on larger screens and stacks on smaller screens.
- [x] Simulation and backtesting explicitly separate model outputs from observed historical data.
- [x] Historical comparison uses only available market series and marks missing fixed-income history as unavailable.
- [x] Portfolio updates continue to go through the existing ledger/version/audit APIs.
- [x] Historical interpretation changes remain confirmation-gated by the existing flow.
- [x] Asset detail inspection is available without leaving the portfolio workspace.
- [x] Export/import, local cache controls, assumptions visibility, and full local reset are available in Settings.
- [x] Runtime and asynchronous errors have a visible, non-destructive error state.
- [x] Reusable SVG line and donut chart components are dependency-free and tested.
- [x] Existing calculation engine modules were not rewritten.
- [x] Direct browser verification found and fixed a missing closing section that had nested every view after Plan inside the Plan view.

## Important product decisions

1. A portfolio value or profit/loss is shown as unavailable when any held asset lacks a valid price. Showing a partial total as a complete total would be misleading.
2. A historical comparison is an indexed performance comparison with the first observed value set to 100. It is not presented as a currency-value comparison when cash-flow alignment is unavailable.
3. Fixed-income market cards can show the current annual return, but the historical comparison does not invent a time series when the API does not supply one.
4. Contribution consistency is described as evidence of recorded deposits/opening/buy events. The app does not claim to observe contributions that were never entered into the local ledger.
5. The market cache preference is local-only. When disabled, a failed request results in unavailable data instead of silently using stale browser data.

## Remaining limitations

- The market API remains dependent on public upstream sources and network availability.
- Fixed-income historical comparison remains unavailable until the market API supplies a historical series.
- The supplied `533748e7.invest-consult.pages.dev` address is an older immutable deployment and still shows the pre-fix nesting. The corrected commit was deployed separately and verified at the commit preview recorded in PR #1.
- Direct browser verification covered the corrected desktop deployment and the main data-entry paths. A real mobile/tablet viewport pass remains a deployment QA gate because this browser session does not expose viewport emulation.
