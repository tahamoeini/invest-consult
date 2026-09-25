# Portfolio simulation and recommendation model

## Purpose and scope

This note records the implemented calculation path, assumptions, and known limits for Synthora's planning model. Outputs describe conditional scenarios from supplied assumptions and observed price history. They are not price targets, forecasts, or investment advice.

The browser UI, Worker, and tests share the pure calculation code in `src/engine.js`. `src/analysis.js` selects the simulation method and supplies observed market data. `functions/api/history.js` obtains and normalizes historical prices. The UI in `app.js` displays provenance, assumptions, and unavailable states.

## Calculation path

### 1. Inputs and weights

The simulation validates that at least one allocation is positive and that no weight is negative or non-finite, then normalizes active weights to 100%. Missing weight fields mean zero weight; an entirely empty simulation allocation is rejected instead of replaced with the default portfolio. Monetary amounts and horizon limits are read from the form, whose defaults are visible to the investor.

### 2. Asset return basis and provenance

| Asset                       | Stored or modeled basis                                   | Transformation used by the simulation                                                                                |
| --------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Fixed income                | D. Fixed-rate instrument                                  | Effective annual yield becomes an effective monthly yield. There is no observed NAV return history.                  |
| TGJU gold and silver        | A. Local Toman price return                               | Use observed monthly Toman prices directly. Do not add FX or historical inflation.                                   |
| Gold or silver fallback     | C. Global quote plus dated USD/TOMAN conversion           | Convert each source observation with same-date FX, then use Toman price returns. Do not add FX again.                |
| Copper, platinum, palladium | C. Global commodity quote plus dated USD/TOMAN conversion | Yahoo quotes are converted from USD per pound or troy ounce to USD per gram, then multiplied by same-date USD/TOMAN. |
| USD/TOMAN                   | F. Local exchange-rate return                             | Use the observed Toman-per-USD series as its own asset return.                                                       |
| Bitcoin, Ethereum, Tether   | E. USD-quoted crypto plus dated USD/TOMAN conversion      | Convert dated USD prices into Toman before calculating returns. Tether depeg risk is not modeled.                    |

Daily observations are reduced to the latest dated observation in each calendar month. When the source retrieval timestamp is available, the still-open current month is excluded so a partial-month return is not treated as a full monthly return. A return exists only when adjacent calendar months both have a valid close. Missing months are not filled. Historical data from a local Toman price series already contains the price effects present in that series; the model does not add historical CPI or FX to it.

### 3. Return and risk estimates

An asset needs at least 24 observed monthly returns before its historical arithmetic mean and sample volatility replace its versioned configured assumptions. The documented annualized arithmetic estimate is `(1 + mean(monthly simple returns))^12 - 1`; the separately displayed historical geometric return is `exp(12 × mean(log(1 + monthly return))) - 1`. Monthly sample standard deviation uses `n - 1`; annual volatility is monthly standard deviation times `sqrt(12)`. Fallback assumptions remain labeled as assumptions, never as observed history.

Pair covariance uses only rows where both assets have observed monthly returns. With fewer than 24 paired observations, empirical correlation is blended toward a visible judgmental prior; at 24 or more, the observed pair correlation is used. Gold and silver have a positive fallback relationship. Copper has separate priors and uses its own observed series when available. The Gaussian generator factors only the selected market assets, so an unrelated unselected asset cannot force shrinkage of the portfolio's active correlations. Fixed income is not assigned commodity or equity covariance because its NAV history is unavailable; it follows its separate rate process.

If a covariance-derived lognormal correlation matrix is not positive semidefinite, all off-diagonal correlations are reduced by a common retention factor until Cholesky factorization succeeds. The result shows that retained factor. A zero factor means the matrix needed the independent fallback to remain numerically valid; it is not reported as historical precision.

### 4. Fixed-income yield process

The provider field is parsed from a displayed effective-annual-yield percentage. A current quote is a reference value, not a promise it will persist. Three run modes are available:

- **Mean-reverting (default):** starts at the current reference when available and moves monthly toward the configured long-term effective annual rate, with a separately modeled yield-rate shock.
- **Constant current market:** holds the current effective annual yield for the whole horizon. If the current quote is unavailable, the UI discloses the configured-rate fallback.
- **User expected:** holds the configured effective annual yield for the whole horizon.

An effective annual rate `y` is converted by `(1 + y)^(1/12) - 1`; a 40% effective annual yield is about 2.8436% per month and compounds to 40% over 12 months. This model does not have fund NAV history and does not model duration-driven bond-price losses, defaults, fund-specific fees, or liquidity gates.

### 5. Path generation and rebalancing

The Gaussian method generates correlated lognormal monthly market returns while calibrating the expected simple monthly return and covariance. It is compared with a three-month moving-block bootstrap when all active market assets have at least 24 complete, contiguous monthly returns. The app selects EWMA or block bootstrap only after its walk-forward gate; the comparison view reports Gaussian and bootstrap ranges when joint data exists. Bootstrap preserves three-month serial blocks and same-month cross-asset relationships, but it cannot generate shocks absent from the sampled history. Gaussian paths have thinner tails than many real markets.

Monthly contributions enter at month end, after that month's asset return. Rebalancing then occurs at the chosen cadence (monthly, quarterly, annually, or when target drift reaches its threshold). It is disabled only when the user unchecks it. At a rebalance, the engine solves for the post-fee portfolio value, charges buy and sell fees plus half the configured spread on each side, resets holdings to the target, and records half the sum of absolute traded value as turnover.

Gold, silver, and copper use the disclosed market-hour default of 0.5% on buys and 0.5% on sells. No separate off-hours rate is available. Spread is unknown by default and modeled as zero with an explicit UI disclosure. Unknown buy/sell fees on other instruments are likewise shown as unknown and modeled as zero. Invalid or impossible transaction fee inputs are rejected; fees are not silently capped.

New monthly money follows the target where drift is within tolerance. When projected target contributions leave a drift outside the configured threshold (default 3 percentage points), money is directed toward the amount needed to reduce the target gaps, fee-adjusted, before any remaining contribution returns to target weights. This does not sell existing holdings.

### 6. Nominal and real outcomes

Nominal balances are account values after modeled asset returns, contributions, and transaction costs. A constant annual inflation scenario `i` over `T` years uses cumulative factor `(1 + i)^T`; real value in today's toman is `nominal final value / (1 + i)^T`. For the required 72% two-year scenario, the factor is `1.72^2 = 2.9584`.

For a single invested amount, real annual return follows Fisher's equation `(1 + nominal return) / (1 + inflation) - 1`. Contributions are dated month-end cash flows. Nominal CAGR is their money-weighted monthly IRR annualized by compounding; real CAGR solves the same cash-flow IRR after deflating each dated deposit and the final value into today's toman. The purchasing-power change compares final real value with the sum of each contribution in today's toman. Inflation is applied once to output values and hurdles, never on top of asset returns.

P10, P50, and P90 are empirical percentiles of the simulated ending balances: 10% of paths are below P10; P50 is the median; 10% are above P90. Each percentile is displayed in both nominal and real terms. They are not forecast confidence intervals. Probability of preserving purchasing power compares ending value with the inflation-protected future value of each dated contribution; nominal-loss probability compares with total nominal contributions.

### 7. Risk measures

- **Nominal maximum drawdown:** peak-to-trough drawdown of the unitized monthly portfolio-return path, with external contributions removed.
- **Real maximum drawdown:** peak-to-trough drawdown of that unitized path after applying monthly inflation deflation.
- **Purchasing-power drawdown:** largest shortfall of the inflation-adjusted account balance versus cumulative contributions expressed in today's toman. It is a contribution-relative measure, not another peak-to-trough measure.
- **Annualized volatility:** sample standard deviation of cash-flow-adjusted monthly portfolio returns times `sqrt(12)`.
- **Sortino:** MAR is selected explicitly as 0% annual (default), scenario inflation, or the current effective fixed-income yield. Effective annual MAR converts to monthly using `(1 + MAR)^(1/12) - 1`. Downside means strictly below MAR; a zero return is not downside at zero MAR. Numerator is mean monthly excess return times 12; denominator is root-mean-square monthly shortfall times `sqrt(12)`. At least 24 monthly returns and five downside observations are required to reduce sensitivity to one or two tail outcomes. Missing MAR, too few observations, too few downside observations, or zero/negligible downside returns an unavailable state, never an infinite or capped ratio. Monte Carlo displays the median valid per-path ratio and labels it as simulation-derived; it is not a historical performance statistic and inherits all return, correlation, and fixed-income assumptions.
- **Sharpe:** shown only when the user checks the fixed-income benchmark. It uses mean monthly arithmetic excess return times 12 divided by annualized monthly volatility, and is unavailable when the benchmark or nonzero volatility is absent.
- **VaR and CVaR:** 95% estimates from the pooled simulated monthly portfolio-return distribution, only when at least 200 simulated monthly observations exist. These are model outputs, not empirically calibrated loss limits.

### 8. Recommendation and data-quality reporting

The profile rules adjust fixed-income weight using goal, horizon, age, income stability, emergency-fund status, and risk tolerance. The default 3% minimum meaningful allocation removes smaller suggested sleeves and redistributes them; users can explicitly enable micro-allocations. Conservative profiles do not automatically receive FX, crypto, platinum, or palladium unless the user enables them or existing FX exposure is present. Copper only enters the recommendation when selected.

Current holdings affect contribution routing. Existing concentrations are not sold: new money preferentially fills underweight target gaps and accounts for known buy costs. The result continues to show the target separately from this month's buy amounts.

Every run shows per-asset observation counts, date coverage, source, monthly frequency, basis/transformation, proxy status, return source, and modeled transaction costs. The portfolio-level High/Medium/Low label means:

- **High:** 60+ joint monthly returns, complete direct histories for all active market assets, no fixed-income scenario, and no proxy data.
- **Medium:** at least 24 joint returns and complete market-asset coverage, but fixed income, proxy data, or modeled risk assumptions limit confidence.
- **Low:** joint history or asset coverage is insufficient; returns, correlations, or both rely on assumptions.

Data quality describes coverage and model dependence; it does not certify source accuracy or predictive power. The fixed income instrument has no history, and a proxy source remains a proxy even when it has enough observations.

## Validation and required reference portfolio

Deterministic seeded coverage lives in `tests/financial-model.test.js` and `tests/history-api.test.js`. It covers 100% fixed income, 100% gold, the 53/31/10/6 reference mix, 72% and zero inflation, negative returns, high fees, no and quarterly rebalancing, missing/short histories, perfect and zero correlation, zero downside, very high inflation, Fisher conversion, dated copper USD/lb-to-Toman/g conversion, and recommendation target drift. Assertions cover percentile order, nominal/real consistency, finite values, nonnegative balances, valid weights, explicit unavailable metrics, costs, and reproducibility.

The required reference portfolio is:

- Initial amount: 210,000,000 toman
- Monthly contribution: 0
- Horizon: 2 years
- Weights: 53% fixed income, 31% gold, 10% silver, 6% copper
- Scenario inflation: 72% annually
- Paths: 10,000; quarterly rebalancing enabled

The fixture test uses 60 synthetic dated monthly observations for repeatability. It verifies the end-to-end calculation path and is not a substitute for running the same form against current production data sources. Production inputs can differ because of history availability, current fixed-income yield, source coverage, and model method selection.

### Manual interface check and reconstructed before/after

The Persian RTL interface was manually exercised at a 390-pixel viewport with the reference inputs, nominal/real tabs, model disclosure, cost/turnover rows, and conservative recommendation preview. The local Pages preview's history request failed in this restricted environment, so the run correctly reported Low data quality, zero joint observed months, and configured-return fallbacks. It used the 25% effective fixed-income assumption, quarterly rebalancing, 0.5% buy/sell fees for gold, silver, and copper, and seed 42. These values verify the UI/formula path only; they are not a production-data result or forecast.

| Reference output                          | Baseline engine at task start |                                      Hardened UI local fallback run |
| ----------------------------------------- | ----------------------------: | ------------------------------------------------------------------: |
| Deterministic central nominal value       |                   329,686,486 |                                                         328,902,871 |
| P10 nominal                               |                   281,157,827 |                                                         267,841,831 |
| P50 nominal                               |                   327,992,240 |                                                         324,215,272 |
| P90 nominal                               |                   383,823,944 |                                                         395,748,548 |
| Central real value                        |                   111,440,808 |                                                         111,175,930 |
| P10 real                                  |                    95,037,124 |                                                          90,536,044 |
| P50 real                                  |                   110,868,118 |                                                         109,591,425 |
| P90 real                                  |                   129,740,381 |                                                         133,771,142 |
| Annualized volatility                     |                          8.4% |                                                               10.8% |
| Sortino                                   |                          8.16 | 5.10, median of simulation paths with at least five downside months |
| Nominal maximum drawdown                  |                          3.4% |                                                                4.9% |
| Real maximum drawdown                     |                   unavailable |                                                               48.2% |
| Probability of beating scenario inflation |                   unavailable |                                                                0.0% |
| Median modeled transaction fees           |                       omitted |                                                       859,719 toman |
| Median rebalancing turnover               |                       omitted |                                                    60,201,086 toman |

The baseline values were reconstructed from the checked-in engine revision using the same fallback return assumptions and an injected seed of 42 because that revision's normal UI run used unseeded randomness. The baseline rebalanced monthly and omitted transaction costs; the hardened run uses the disclosed quarterly cadence and fees. These are not a controlled single-variable A/B comparison. Both use the correct cumulative inflation factor `1.72^2 = 2.9584`; every real value in the table is the corresponding nominal value divided by that factor (rounded to whole toman). The new real drawdown exposes the purchasing-power decline that the baseline did not report.

## Known limitations

There is no historical NAV or duration model for fixed-income funds; the provider's current yield and configured long-term rate do not represent all Iranian debt products. Proxy commodity histories can have basis mismatch and same-day FX conversion does not measure domestic premiums, market-hour spreads, taxes, settlement, or liquidity. Public price history may be revised, sparse, survivorship-biased at the instrument-selection level, or unavailable for discontinued assets. The instrument universe is selected by the user and current catalog; there is no delisted-fund or historical constituent universe.

The Gaussian method assumes lognormal monthly market returns. Bootstrap retains sampled dependence but cannot create unprecedented shocks; neither method validates expected-return assumptions. Method selection uses historical walk-forward scores, which are still subject to sample-selection effects. Recommendation rules are guardrails, not an optimizer or individualized financial advice. Results remain scenario ranges and should not be interpreted as forecasts.
