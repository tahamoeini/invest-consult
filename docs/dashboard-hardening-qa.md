# Dashboard hardening QA

Branch: `feat/dashboard-trust-hardening`

## Completed local checks

- [x] `npm run check` — passed.
- [x] `npm test` — 29/29 passed.
- [x] `git diff --check` — passed.
- [x] Dashboard contract checks cover the six summary metrics, chart containers, action allocation, sibling view structure, and non-persisting plan preview path.
- [x] Financial engine modules remain unchanged in this branch.

## Scenario checklist

| Scenario               | Expected result                                                                                             | Local evidence                                               | Manual preview status |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------- |
| New empty user         | Summary cards and charts explain that values are not available; onboarding remains visible.                 | Dashboard state contract and existing chart tests            | Rerun on preview      |
| Existing portfolio     | Current value, invested amount, P/L amount and percentage use the ledger result.                            | Existing portfolio tests plus dashboard wiring review        | Rerun on preview      |
| Portfolio with history | Tracking duration starts at the ledger tracking start and history remains versioned.                        | Existing history/portfolio tests; no engine changes          | Rerun on preview      |
| Missing market data    | Valuation is unavailable instead of presenting a partial total; market cards remain visible as unavailable. | Existing missing-price behavior plus market rendering review | Rerun on preview      |
| Corrupted storage      | Invalid JSON or invalid stored shape falls back safely and shows a visible warning.                         | `readJson`, `readHistory`, and `readPortfolio` guards        | Rerun on preview      |
| Import/export          | Existing schema validation, confirmation gates, and versioned portfolio payload remain intact.              | Existing history APIs and unchanged ledger flow              | Rerun on preview      |
| Mobile/tablet          | Sidebar/cards/charts stack without horizontal overflow; controls remain touch-friendly.                     | Responsive CSS review                                        | Rerun on preview      |
| Large portfolio        | Rendering remains bounded to monthly chart points and existing ledger limits.                               | Existing rendering limits and monthly series path            | Rerun on preview      |
| API failure            | Cache policy or unavailable state is explicit; no synthetic market quote is created.                        | Existing `loadMarket()` path and diagnostics review          | Rerun on preview      |
| Navigation             | Dashboard, plan, simulation, history, portfolio, assets, and settings remain sibling views.                 | Dashboard contract test                                      | Rerun on preview      |

## Manual preview gate before merge

1. Open the PR preview with an empty browser profile and visit every view.
2. Build a plan, edit salary/contribution/risk inputs, and confirm the result updates without adding a history row until the plan is saved.
3. Register a portfolio with an unavailable market price and confirm the dashboard says unavailable rather than partial.
4. Confirm custom assets appear in the allocation table and action destinations remain understandable.
5. Verify performance chart labels, tooltips, invested/nominal/real legend, and period controls at desktop, tablet, and mobile widths.
6. Exercise export/import, malformed storage recovery, API failure, and the history-change confirmation path.
7. Check keyboard focus, drawer close, disclosure panels, and the absence of horizontal scrolling.

## Performance review

- [x] No new runtime dependency or charting bundle was introduced; charts remain dependency-free SVG/CSS markup.
- [x] Portfolio charts continue to use the existing monthly series rather than rendering one point per transaction.
- [x] Dashboard range filtering reduces the rendered point set before chart markup is generated.
- [x] Live plan previews are debounced by 180ms and deliberately skip history writes, preventing a local-storage write per keystroke.
- [x] Large ledger/audit lists remain bounded to the existing visible-row limits.
- [ ] Capture browser profiler and mobile paint/scroll evidence on the deployed PR preview before merge.

## Current limitation

The browser-control session used for this branch repeatedly timed out before opening a tab, so new screenshots and live interaction evidence could not be captured in this work session. The branch is intentionally not marked merge-ready until the manual preview gate above is run against the deployed PR preview.
{��뗸��ۍ���zw�u�m:�]<m�|}�
