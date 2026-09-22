# Market data and forecasting boundary

This application separates market observation from portfolio valuation and planning.

## Live market observations

The Cloudflare market function reads configured public sources and returns normalized quotes:

- Domestic dollar, gold, and silver: TGJU, Bonbast, and the Navasan public data mirror.
- Global crypto reference prices: CoinGecko USD prices can be converted through the aggregated domestic dollar quote. Binance BTCUSDT/ETHUSDT quotes are recorded as USDT-denominated provider results but excluded from Toman aggregation until a verified USDT/TOMAN rate is available; USDT is not assumed to equal USD cash.
- Global metals: Metals.live plus Yahoo Finance futures charts for platinum, palladium, and copper; ChartGoldPrice is a cold standby for gold and silver when primary coverage is degraded or conflicted.
- Tehran market reference: the public TSETMC index endpoint, exposed as an index-point reference rather than a tradeable portfolio holding.
- Fixed income: the configured fund-provider page.

Prices are normalized to the unit shown in the response. Direct quotes are distinct from converted quotes; derived values list their dependencies. `observedAt` represents the upstream observation time when the provider supplies one, while `retrievedAt` records when this service read it. Unknown observation time stays unknown; retrieval time is never substituted as observation time.

The `/api/market?assets=...` query accepts allow-listed instrument IDs. It returns only those requested instruments; conversion dependencies such as the domestic dollar rate are fetched internally. The dashboard requests its indicators and held market instruments rather than downloading the full catalog.

Independent provider calls run concurrently with bounded timeouts. Domestic fallback providers are requested only when primary coverage is degraded or conflicted. Provider failure does not discard successful partial data. The initial interactive budget is 3.5 seconds and is included in diagnostics with observed response time.

Quote quality is conservative. A single source is visible with low confidence. Two sources are accepted only when they agree under a calibrated class-specific policy. Three or more sources use the median and median absolute deviation (MAD) to reject outliers. Agreement thresholds have not yet been calibrated against a representative sample, so the current policy treats any remaining disagreement as a conflict. Conflicted prices have no value and are excluded from portfolio valuation. The policy version and calibration state travel with the quote.

No new provider has been added in this implementation. Before enabling one, review its current API terms, display and redistribution rights, quotas, and freshness expectations. Global equities, Iran ticker search, automatic inflation, and BYOK remain out of scope until their data and key-handling contracts are verified.

## Portfolio behavior

The catalog separates priceable instruments from strategic sleeves. It defines cash/liquidity, fixed income, gold, FX, Iran equity, global equity, crypto, and commodities. Existing planning keys remain compatible and map as follows: `fixed` to fixed income, `gold` to gold, `currency` to FX, and `silver` to commodities.

The recommendation, simulation, and backtest engine currently model only the original four planning assets:

- fixed income
- gold
- currency
- silver

The expanded assets are optional portfolio assets. A user can record market-priced quantities for bitcoin, ethereum, tether, platinum, palladium, copper, gold, silver, and currency. The ledger stores the transaction and captured quote provenance, while missing or conflicted market prices prevent valuation rather than creating a synthetic value. Net worth, investable capital, liquid assets, and emergency-fund coverage are reported separately. Assets in other sleeves remain visible but are excluded from recommendation drift and goal simulation until those sleeves have adequate history or a versioned assumption. The Tehran index remains a reference indicator and is not offered as an owned holding.

New monthly contributions are directed toward underweight planning assets; the recommendation does not tell the user to sell holdings. Drift is shown in percentage points. Assets outside the four modeled planning categories are called out explicitly.

## Forecasting and Hugging Face

Hugging Face models and datasets can support research and an explicitly labeled forecasting experiment, but they are not authoritative quote sources. Forecast output must never replace a current market quote, a transaction price, or the portfolio valuation used for profit/loss.

The current production path does not call a hosted model, require a hidden token, or present model output as a prediction. Return and risk fallback assumptions carry the `ir-planning-v1` version. Historical covariance uses only overlapping observed monthly returns; short paired samples shrink correlations toward zero, and imputed returns never enter covariance.

The existing Gaussian Monte Carlo baseline remains available. Additional versioned methods include 12-month-half-life EWMA volatility (`mc-ewma-v1`) and a three-month moving-block bootstrap (`mc-block-bootstrap-v1`). Walk-forward comparisons use a 24-month training window and require at least 24 out-of-sample forecasts before enabling either method. Otherwise, the baseline stays active. These are implementation gates, not a claim that the models predict future returns.

Simulation and backtest run only after the analysis view is opened and execute in a browser Web Worker. Navigation and changed planning inputs cancel stale work. Goal planning uses the same simulation model for success probability, P10/P50/P90, inflation-adjusted target, and a binary search for required monthly contributions. Goal projections use only the four currently modeled portfolio categories; other investable holdings are shown as excluded.

A future Hugging Face integration should be optional, server-side, rate-limited, and return:

- model and revision;
- input history window and timestamp;
- forecast horizon;
- point estimate and uncertainty interval;
- backtest error metrics;
- a clear “scenario, not a guarantee” label.

The browser should use such output only in a separate analysis panel. It must not write forecasts into the immutable portfolio ledger or use them as current prices.
