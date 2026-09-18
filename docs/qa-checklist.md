# Invest Consult — final QA checklist

## Automated checks

- `npm run check` — passed
- `npm test` — passed
- `git diff --check` — passed
- Direct browser smoke test on the corrected Cloudflare preview — passed for all seven view transitions, plan generation, Monte Carlo output, backtest output, history comparison, portfolio registration, stock entry, allocation drawer open/close, and market snapshot rendering.

## Scenario matrix

| Scenario | Expected behavior | Coverage |
| --- | --- | --- |
| New user with no data | Dashboard uses onboarding and empty states; no financial value is fabricated. | Dashboard state logic + chart empty states |
| Existing plan history | Dashboard can recover the latest saved monthly plan after reload. | `latestPlanSnapshot()` |
| Portfolio only | Portfolio summary, allocation, ledger, and dashboard values use the active ledger. | Existing portfolio engine + new UI wiring |
| Missing market data | Held assets with missing prices show unavailable valuation; missing chart periods remain gaps. | Existing portfolio tests + chart tests |
| Import/export | Existing versioned history and portfolio payload remain on the existing schema path. | Existing history tests + unchanged APIs |
| Currency migration | Existing migration keys and TOMAN conversion path remain intact. | Existing migration code preserved |
| Mobile viewport | Sidebar becomes a compact drawer; cards stack; charts and tables stay within the viewport. | Responsive CSS review |
| Empty charts | Reusable chart module returns an explicit Persian empty state. | `tests/charts.test.js` |
| Broken API response | Cache fallback or unavailable state is used; no synthetic quote is created. | `loadMarket()` + existing API behavior |
| Large portfolio dataset | Rendering is bounded to visible ledger/audit rows; series is monthly rather than transaction-per-pixel. | Existing rendering limits + monthly `portfolioSeries()` |

## Manual preview checks before merge

1. Open the PR preview with an empty browser profile.
2. Build a plan, reload, and verify the dashboard still shows the saved plan amount.
3. Register a portfolio with a missing gold/silver history and verify valuation is unavailable rather than partial.
4. Use the allocation row to open and close the asset detail drawer.
5. Toggle market-cache privacy, force an API failure, and verify the UI does not use stale cache.
6. Test import/export with an existing portfolio and confirm the confirmation prompt appears before replacement.
7. Test desktop, tablet, and mobile widths; verify no horizontal scroll is introduced.
8. Verify keyboard focus can reach navigation, range buttons, forms, disclosure panels, and drawer close.

## Regression note

The original PR preview had a missing closing `</section>` after the Plan workspace. That nested Simulation, History, Portfolio, Assets, and Settings inside the hidden Plan view. The corrected branch closes the Plan view before its sibling sections; the new Cloudflare deployment was verified directly in the browser. The older immutable preview URL may continue to show the broken commit.
