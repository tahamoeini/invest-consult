# Market data and forecasting boundary

This application separates market observation from portfolio valuation and planning.

## Live market observations

The Cloudflare market function reads configured public sources and returns normalized quotes:

- Domestic dollar, gold, and silver: TGJU, Bonbast, and the Navasan public data mirror.
- Global crypto reference prices: CoinGecko and CoinMarketCap USD quotes can be converted through the aggregated domestic dollar quote. CoinMarketCap is an optional, server-keyed source with a 15-minute cache and 15,000-request monthly ceiling. Binance BTCUSDT/ETHUSDT quotes are recorded as USDT-denominated provider results but excluded from Toman aggregation until a verified USDT/TOMAN rate is available; USDT is not assumed to equal USD cash.
- Global metals: Metals.live plus ChartGoldPrice as a cold standby for gold and silver when primary coverage is degraded or conflicted. Bank of Russia daily precious-metal reference prices are shown separately in RUB per gram. Yahoo Finance market and history requests stay disabled unless an operator explicitly confirms the applicable license.
- Tehran market reference: the public TSETMC index endpoint, exposed as an index-point reference rather than a tradeable portfolio holding.
- Fixed income: the configured fund-provider page.

Prices are normalized to the unit shown in the response. Direct quotes are distinct from converted quotes; derived values list their dependencies. `observedAt` represents the upstream observation time when the provider supplies one, while `retrievedAt` records when this service read it. Unknown observation time stays unknown; retrieval time is never substituted as observation time.

The `/api/market?assets=...` query accepts allow-listed instrument IDs. It returns only those requested instruments; conversion dependencies such as the domestic dollar rate are fetched internally. The dashboard requests its indicators and held market instruments rather than downloading the full catalog.

Independent provider calls run concurrently with bounded timeouts. Domestic fallback providers are requested only when primary coverage is degraded or conflicted. Provider failure does not discard successful partial data. The initial interactive budget is 3.5 seconds and is included in diagnostics with observed response time.

Quote quality is conservative. A single source is visible with low confidence. Two sources are accepted only when they agree under a calibrated class-specific policy. Three or more sources use the median and median absolute deviation (MAD) to reject outliers. Agreement thresholds have not yet been calibrated against a representative sample, so the current policy treats any remaining disagreement as a conflict. Conflicted prices have no value and are excluded from portfolio valuation. The policy version and calibration state travel with the quote.

The app also exposes `/api/fx?quotes=USD,RUB,CNY` for dated conversion references. USD/Toman is derived from the accepted Iran-market dollar quote; RUB uses the Bank of Russia daily rate, and CNY uses the CFETS observation through Frankfurter. These rates and the Bank of Russia metals series are daily references, not Iranian live retail quotes. Selected provider responses use a shared D1 cache and request coordinator: ordinary sources have a minimum 60-second interval, CoinGecko uses a six-minute cache, CoinMarketCap uses a 15-minute cache, and daily FX sources use a 24-hour cache. Provider `Retry-After` values extend cooldowns. Stale cache entries are marked; stale quote inputs are excluded from current quote aggregation. This cache is operational coordination, not a canonical durable market-history dataset. No new crawling or scraping source was added. Review terms, display and redistribution rights, quotas, attribution, and freshness before enabling another source. Global equities and Iran ticker search remain out of scope until their data contracts are verified. CoinGecko user-key support is available as described in the [Cloudflare API guide](cloudflare-market-api.md); other user-supplied provider keys are not supported. `/api/inflation` supplies an annual World Bank CPI reference, which remains distinct from an investor-selected scenario assumption.

## Portfolio behavior

The catalog separates priceable instruments from strategic sleeves. It defines cash/liquidity, fixed income, gold, FX, Iran equity, global equity, crypto, and commodities. Existing planning keys remain compatible and map as follows: `fixed` to fixed income, `gold` to gold, `currency` to FX, and `silver` to commodities.

The shared planning catalog maps stable IDs to the fixed-income, gold, FX, crypto, and commodity sleeves. The default recommendation remains the original four assets: fixed income, gold, currency, and silver. Copper, platinum, palladium, bitcoin, and ethereum can be opted into each recommendation independently. Selected metals divide the existing commodity allocation by inverse estimated volatility. Selected crypto receives a 1%, 3%, or 5% target for conservative, balanced, or growth profiles; bitcoin and ethereum divide that target by inverse volatility, and their combined weight never exceeds 5%. Tether is available only in the manually weighted simulation; the Tehran index is an indicator, not an investable instrument.

Simulation accepts all catalog planning assets plus Tether, with newly added assets at zero weight by default. It uses the per-asset expected-return and volatility assumptions stored in model settings when observed history is insufficient. These are editable scenario inputs, not asserted forecasts. Existing portfolio assets and old recommendation records are preserved; assets introduced after an older record are treated as zero weight. Recommendations are previews until the user explicitly saves one. They only allocate new monthly contributions and do not sell or modify holdings or transactions.

Backtests use observed monthly price history only. Modeled fallback returns are never presented as historical data. A selected asset with missing or discontinuous observations makes the requested backtest unavailable, and the UI identifies the missing coverage rather than filling it with assumptions. Long crypto backtests may therefore be unavailable when the provider does not offer enough historical data.

## Hosted models and prediction boundary

The production app does not call Hugging Face or another hosted model to predict asset prices. It does not require a hosted-model token or present model output as a price prediction. The versioned return and risk assumptions in `src/engine.js`, observed historical inputs, Monte Carlo paths, and goal projections are planning scenarios; their outputs must not replace a current market quote, transaction price, or portfolio valuation. A hosted forecasting feature would change the product's stated boundary and needs a separate product and model review before it is proposed as user-facing behavior.

The existing Gaussian Monte Carlo baseline remains available. Additional versioned methods include 12-month-half-life EWMA volatility (`mc-ewma-v1`) and a three-month moving-block bootstrap (`mc-block-bootstrap-v1`). Walk-forward comparisons use a 24-month training window and require at least 24 out-of-sample forecasts before enabling either method. Otherwise, the baseline stays active. These are method-selection gates, not a claim that the models predict future returns.

Simulation and backtest run only after the analysis view is opened and execute in a browser Web Worker. Navigation and changed planning inputs cancel stale work. Goal planning uses the same simulation model for success probability, P10/P50/P90, an inflation-adjusted target, and a binary search for required monthly contributions. Goal projections use planning assets; unsupported personal holdings are shown as excluded.
