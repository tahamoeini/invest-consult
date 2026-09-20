# Market data and forecasting boundary

This application separates market observation from portfolio valuation and planning.

## Live market observations

The Cloudflare market function reads public sources and returns only validated quotes:

- Domestic dollar, gold, and silver: TGJU, Bonbast, and the Navasan public data mirror.
- Global crypto reference prices: CoinGecko and Binance public tickers, converted through the aggregated domestic dollar quote.
- Global metals: Metals.live, with existing ChartGoldPrice/TGJU coverage retained for gold and silver.
- Tehran market reference: the public TSETMC index endpoint, exposed as an index-point reference rather than a tradeable portfolio holding.
- Fixed income: the configured fund-provider page.

Prices are normalized to the unit shown in the response. Valid quotes are combined with a median; failed sources are omitted. The response includes source diagnostics so the UI can show coverage and unavailable data instead of inventing or silently reusing a stale number.

## Portfolio behavior

The recommendation, simulation, and backtest engine still use the original four planning assets:

- fixed income
- gold
- currency
- silver

The expanded assets are optional portfolio assets. A user can record market-priced quantities for bitcoin, ethereum, tether, platinum, palladium, copper, gold, silver, and currency. The ledger stores the transaction and captured market quote, while missing market prices prevent valuation rather than creating a synthetic value. The Tehran index remains a reference indicator and is not offered as an owned holding.

## Forecasting and Hugging Face

Hugging Face models and datasets can support research and an explicitly labeled forecasting experiment, but they are not authoritative quote sources. Forecast output must never replace a current market quote, a transaction price, or the portfolio valuation used for profit/loss.

The current production path therefore keeps the existing transparent historical-return estimation and Monte Carlo analysis. It does not call an unverified hosted model, require a hidden token, or present model output as a prediction. A future Hugging Face integration should be optional, server-side, rate-limited, and return:

- model and revision;
- input history window and timestamp;
- forecast horizon;
- point estimate and uncertainty interval;
- backtest error metrics;
- a clear “scenario, not a guarantee” label.

The browser should use such output only in a separate analysis panel. It must not write forecasts into the immutable portfolio ledger or use them as current prices.
