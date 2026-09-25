// @ts-check

/**
 * Pure, dependency-free planning and analysis functions.
 *
 * The browser and the test suite use this module. It deliberately contains no
 * DOM, network, storage, or provider-specific code.
 */

import {
  OPTIONAL_RECOMMENDATION_ASSETS,
  INSTRUMENT_REGISTRY,
  PLAN_ASSET_KEYS,
  SIMULATION_ASSET_KEYS,
} from "./market/catalog.js";

export const ASSET_KEYS = SIMULATION_ASSET_KEYS;
export const MODEL_ASSUMPTION_VERSION = "ir-planning-v2";
export const MONTE_CARLO_MODEL_VERSION = "mc-gaussian-v1";
export const BOOTSTRAP_MODEL_VERSION = "mc-block-bootstrap-v1";
export const MIN_PAIRED_MONTHS = 24;
export const MIN_WALK_FORWARD_FORECASTS = 24;
export const BOOTSTRAP_BLOCK_MONTHS = 3;
export const EWMA_HALF_LIFE_MONTHS = 12;

export const DEFAULT_ALLOCATION = Object.freeze({
  fixed: 72,
  gold: 18,
  currency: 8,
  silver: 2,
  bitcoin: 0,
  ethereum: 0,
  platinum: 0,
  palladium: 0,
  copper: 0,
  tether: 0,
});

export const DEFAULT_ASSUMPTIONS = Object.freeze({
  fixed: { annualReturn: 0.25, annualVolatility: 0.04 },
  gold: { annualReturn: 0.25, annualVolatility: 0.24 },
  currency: { annualReturn: 0.25, annualVolatility: 0.22 },
  silver: { annualReturn: 0.28, annualVolatility: 0.34 },
  bitcoin: { annualReturn: 0.25, annualVolatility: 0.8 },
  ethereum: { annualReturn: 0.25, annualVolatility: 0.95 },
  tether: { annualReturn: 0.25, annualVolatility: 0.25 },
  platinum: { annualReturn: 0.25, annualVolatility: 0.3 },
  palladium: { annualReturn: 0.25, annualVolatility: 0.42 },
  copper: { annualReturn: 0.25, annualVolatility: 0.35 },
});

export const GOALS = Object.freeze({
  liquidity: { fixedBias: 5 },
  preservation: { fixedBias: 3 },
  retirement: { fixedBias: 0 },
  growth: { fixedBias: -4 },
});

const EPSILON = 1e-9;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

export function mean(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? sum(valid) / valid.length : 0;
}

export function median(values) {
  const valid = values
    .filter(Number.isFinite)
    .slice()
    .sort((left, right) => left - right);
  if (!valid.length) return null;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
}

export function standardDeviation(values) {
  const valid = values.filter(Number.isFinite);
  if (valid.length < 2) return 0;
  const average = mean(valid);
  return Math.sqrt(mean(valid.map((value) => (value - average) ** 2)));
}

export function annualizedVolatility(returns) {
  return standardDeviation(returns) * Math.sqrt(12);
}

export function sortinoRatio(returns, targetMonthlyReturn = 0) {
  const valid = returns.filter(Number.isFinite);
  if (valid.length < 2) return null;
  const downside = Math.sqrt(mean(valid.map((value) => Math.min(0, value - targetMonthlyReturn) ** 2)));
  return downside > EPSILON ? ((mean(valid) - targetMonthlyReturn) / downside) * Math.sqrt(12) : null;
}

export function percentile(values, probability) {
  const valid = values
    .filter(Number.isFinite)
    .slice()
    .sort((left, right) => left - right);
  if (!valid.length) return null;
  const position = clamp(probability, 0, 1) * (valid.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return valid[lower];
  return valid[lower] + (valid[upper] - valid[lower]) * (position - lower);
}

export function normalizeAllocation(input, fallback = DEFAULT_ALLOCATION, assetKeys = ASSET_KEYS) {
  const raw = {};
  assetKeys.forEach((key) => {
    raw[key] = Math.max(0, Number(input && input[key]) || 0);
  });
  const total = sum(Object.values(raw));
  if (total <= EPSILON) {
    const fallbackAllocation = Object.fromEntries(
      assetKeys.map((key) => [key, Math.max(0, Number(fallback && fallback[key]) || 0)]),
    );
    const fallbackTotal = sum(Object.values(fallbackAllocation));
    if (fallbackTotal <= EPSILON) return fallbackAllocation;
    return Object.fromEntries(assetKeys.map((key) => [key, (fallbackAllocation[key] / fallbackTotal) * 100]));
  }
  const normalized = {};
  assetKeys.forEach((key) => {
    normalized[key] = (raw[key] / total) * 100;
  });
  return normalized;
}

export function roundAllocation(input, assetKeys = ASSET_KEYS) {
  const normalized = normalizeAllocation(input, DEFAULT_ALLOCATION, assetKeys);
  const rounded = Object.fromEntries(assetKeys.map((key) => [key, Math.floor(normalized[key])]));
  let remaining = 100 - sum(Object.values(rounded));
  const order = assetKeys
    .slice()
    .sort((left, right) => normalized[right] - rounded[right] - (normalized[left] - rounded[left]));
  for (let index = 0; index < remaining; index += 1) rounded[order[index % order.length]] += 1;
  return rounded;
}

export function annualToMonthlyRate(annualRate) {
  const annual = Math.max(-0.99, Number(annualRate) || 0);
  return Math.pow(1 + annual, 1 / 12) - 1;
}

export function monthlyToAnnualRate(monthlyRate) {
  return Math.pow(1 + Number(monthlyRate || 0), 12) - 1;
}

export function realValue(nominalValue, inflationRate, years) {
  return (
    Number(nominalValue || 0) /
    Math.pow(1 + Math.max(-0.99, Number(inflationRate) || 0), Math.max(0, Number(years) || 0))
  );
}

export function maxDrawdown(values) {
  let peak = -Infinity;
  let drawdown = 0;
  values.forEach((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    peak = Math.max(peak, numeric);
    if (peak > EPSILON) drawdown = Math.max(drawdown, 1 - numeric / peak);
  });
  return drawdown;
}

function riskValue(value) {
  return { conservative: 0, balanced: 1, growth: 2 }[value] ?? 0;
}

function stabilityValue(value) {
  return { unstable: 2, mixed: 1, stable: 0 }[value] ?? 1;
}

function emergencyValue(value) {
  return { none: 3, partial: 1, complete: 0 }[value] ?? 1;
}

/**
 * Build a conservative allocation from the user's situation.
 * This is a rule system, not a market forecast.
 */
function inverseVolatilityWeights(assetKeys, budget, model) {
  const inverseVolatility = Object.fromEntries(
    assetKeys.map((assetId) => [assetId, 1 / Math.max(Number(model[assetId]?.annualVolatility) || 0, 0.01)]),
  );
  const total = sum(Object.values(inverseVolatility));
  return Object.fromEntries(
    assetKeys.map((assetId) => [assetId, total > EPSILON ? (budget * inverseVolatility[assetId]) / total : 0]),
  );
}

export function recommendAllocation(profile = {}, options = {}) {
  const age = Number.isFinite(Number(profile.age)) && Number(profile.age) > 0 ? clamp(profile.age, 18, 90) : null;
  const horizon = clamp(profile.horizonYears || 5, 1, 50);
  const goal = GOALS[profile.goal] || GOALS.preservation;
  const risk = riskValue(profile.riskTolerance);
  const stability = stabilityValue(profile.incomeStability);
  const emergency = emergencyValue(profile.emergencyFund);

  let fixed = 71 + goal.fixedBias + stability + emergency;
  if (age !== null) fixed += age >= 55 ? 4 : age >= 40 ? 2 : age < 30 ? -2 : 0;
  fixed += horizon <= 3 ? 6 : horizon <= 7 ? 2 : horizon >= 15 ? -4 : 0;
  fixed -= risk * 6;
  fixed = clamp(fixed, 52, 86);

  const nonFixed = 100 - fixed;
  const goldShare = clamp(0.54 - risk * 0.06 + (horizon <= 3 ? 0.05 : 0), 0.38, 0.62);
  const currencyShare = clamp(0.31 + risk * 0.02, 0.22, 0.36);
  const silverShare = 1 - goldShare - currencyShare;
  const weights = {
    ...Object.fromEntries(PLAN_ASSET_KEYS.map((assetId) => [assetId, 0])),
    fixed,
    gold: nonFixed * goldShare,
    currency: nonFixed * currencyShare,
    silver: Math.max(1, nonFixed * silverShare),
  };
  const enabledAssets = new Set(
    (Array.isArray(options.enabledAssets) ? options.enabledAssets : []).filter((assetId) =>
      OPTIONAL_RECOMMENDATION_ASSETS.includes(assetId),
    ),
  );
  const assumptions = options.assumptions || DEFAULT_ASSUMPTIONS;
  const returnModel =
    options.returnModel ||
    (enabledAssets.size ? estimateReturnModel(options.market || {}, assumptions).model : assumptions);
  const enabledCommodities = [
    "silver",
    ...["copper", "platinum", "palladium"].filter((assetId) => enabledAssets.has(assetId)),
  ];
  const commodityWeights = inverseVolatilityWeights(enabledCommodities, weights.silver, returnModel);
  enabledCommodities.forEach((assetId) => {
    weights[assetId] = commodityWeights[assetId];
  });

  const enabledCrypto = ["bitcoin", "ethereum"].filter((assetId) => enabledAssets.has(assetId));
  const cryptoTargets = { conservative: 1, balanced: 3, growth: 5 };
  const cryptoBudget = enabledCrypto.length ? Math.min(cryptoTargets[profile.riskTolerance] || 1, 5) : 0;
  let cryptoWeights = {};
  if (cryptoBudget > 0) {
    const nonFixedAssets = PLAN_ASSET_KEYS.filter((assetId) => assetId !== "fixed" && !enabledCrypto.includes(assetId));
    const nonFixedBudget = sum(nonFixedAssets.map((assetId) => weights[assetId]));
    const remainingBudget = Math.max(0, nonFixedBudget - cryptoBudget);
    const reduction = nonFixedBudget > EPSILON ? remainingBudget / nonFixedBudget : 0;
    nonFixedAssets.forEach((assetId) => {
      weights[assetId] *= reduction;
    });
    const rawCryptoWeights = inverseVolatilityWeights(enabledCrypto, cryptoBudget, returnModel);
    const roundedCryptoWeights = Object.fromEntries(
      enabledCrypto.map((assetId) => [assetId, Math.floor(rawCryptoWeights[assetId])]),
    );
    let remainingCryptoWeight = cryptoBudget - sum(Object.values(roundedCryptoWeights));
    const cryptoRemainderOrder = enabledCrypto
      .slice()
      .sort(
        (left, right) =>
          rawCryptoWeights[right] - roundedCryptoWeights[right] - (rawCryptoWeights[left] - roundedCryptoWeights[left]),
      );
    for (let index = 0; index < remainingCryptoWeight; index += 1)
      roundedCryptoWeights[cryptoRemainderOrder[index % cryptoRemainderOrder.length]] += 1;
    cryptoWeights = roundedCryptoWeights;
    Object.assign(weights, rawCryptoWeights);
  }

  const roundedWeights = roundAllocation(weights, PLAN_ASSET_KEYS);
  if (cryptoBudget > 0) {
    const currentCryptoWeight = sum(enabledCrypto.map((assetId) => roundedWeights[assetId]));
    const nonCryptoAsset = PLAN_ASSET_KEYS.filter((assetId) => !enabledCrypto.includes(assetId)).sort(
      (left, right) => roundedWeights[right] - roundedWeights[left],
    )[0];
    if (nonCryptoAsset) roundedWeights[nonCryptoAsset] += currentCryptoWeight - cryptoBudget;
    Object.assign(roundedWeights, cryptoWeights);
  }

  return {
    weights: roundedWeights,
    enabledAssets: [...enabledAssets],
    facts: {
      age,
      horizon,
      goal: profile.goal || "preservation",
      riskTolerance: profile.riskTolerance || "conservative",
      incomeStability: profile.incomeStability || "mixed",
      emergencyFund: profile.emergencyFund || "partial",
    },
    guardrails: {
      monthlyRateMin: profile.emergencyFund === "complete" ? 15 : 10,
      monthlyRateMax: profile.emergencyFund === "none" ? 20 : 25,
      cryptoWeightCap: 5,
      cryptoWeight: cryptoBudget,
    },
  };
}

function extractSeries(market, key) {
  const raw = market && market.history && market.history[key];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((point) => {
      if (Array.isArray(point)) return { date: point[0], value: Number(point[1]) };
      if (!point || typeof point !== "object") return null;
      return {
        date: point.date || point.time || point.timestamp,
        value: Number(point.value ?? point.price ?? point.close ?? point.c),
      };
    })
    .filter((point) => point && point.date && Number.isFinite(point.value) && point.value > 0)
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
}

function monthlySeries(series) {
  const buckets = new Map();
  series.forEach((point) => {
    const date = new Date(point.date);
    if (Number.isNaN(date.getTime())) return;
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, point);
  });
  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, point]) => ({ month, value: point.value, date: point.date }));
}

function seriesReturns(series) {
  const monthly = monthlySeries(series);
  return monthly
    .slice(1)
    .map((point, index) => ({
      month: point.month,
      date: point.date,
      value: point.value / monthly[index].value - 1,
    }))
    .filter((point) => Number.isFinite(point.value) && point.value > -1);
}

/** Align observed returns with modeled fallbacks while retaining observation flags. */
export function buildHistoricalReturns(market, assumptions = DEFAULT_ASSUMPTIONS) {
  const marketKeys = Object.fromEntries(
    ASSET_KEYS.map((assetId) => [
      assetId,
      assetId === "fixed" ? null : assetId === "currency" ? "dollar" : INSTRUMENT_REGISTRY[assetId]?.marketKey || null,
    ]),
  );
  const actual = {};
  const months = new Set();
  ASSET_KEYS.forEach((asset) => {
    const series = marketKeys[asset] ? seriesReturns(extractSeries(market, marketKeys[asset])) : [];
    actual[asset] = series;
    series.forEach((point) => months.add(point.month));
  });
  const orderedMonths = [...months].sort();
  if (orderedMonths.length === 0) return { rows: [], coverage: {}, observations: 0, estimated: true };

  const rows = orderedMonths.map((month, index) => {
    const row = { month, returns: {}, observed: {} };
    ASSET_KEYS.forEach((asset) => {
      const assumption = assumptions[asset] || DEFAULT_ASSUMPTIONS[asset];
      if (asset === "fixed") {
        row.returns[asset] = annualToMonthlyRate(assumption.annualReturn);
        row.observed[asset] = false;
        return;
      }
      const point = actual[asset].find((candidate) => candidate.month === month);
      row.returns[asset] = point ? point.value : annualToMonthlyRate(assumption.annualReturn);
      row.observed[asset] = Boolean(point);
    });
    row.index = index;
    return row;
  });

  const coverage = {};
  ASSET_KEYS.forEach((asset) => {
    coverage[asset] = rows.length ? rows.filter((row) => row.observed[asset]).length / rows.length : 0;
  });
  return {
    rows,
    coverage,
    observations: rows.length,
    estimated: Object.values(coverage).some((value) => value < 0.75),
  };
}

function currentFixedReturn(market) {
  const value = market && market.funds && market.funds.fixedIncome && market.funds.fixedIncome.effectiveAnnualReturn;
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
    ? Number(value) / 100
    : null;
}

export function estimateReturnModel(market, assumptions = DEFAULT_ASSUMPTIONS) {
  const historical = buildHistoricalReturns(market, assumptions);
  const model = {};
  const ewmaModel = {};
  ASSET_KEYS.forEach((asset) => {
    const values = historical.rows
      .filter((row) => row.observed[asset])
      .map((row) => row.returns[asset])
      .filter(Number.isFinite);
    const configured = assumptions[asset] || DEFAULT_ASSUMPTIONS[asset];
    const observedAnnual = monthlyToAnnualRate(mean(values));
    const observedVolatility = annualizedVolatility(values);
    const ewmaVolatility =
      values.length >= MIN_PAIRED_MONTHS ? exponentiallyWeightedVolatility(values, EWMA_HALF_LIFE_MONTHS) : null;
    const officialFixed = asset === "fixed" ? currentFixedReturn(market) : null;
    const annualReturn =
      officialFixed ?? (values.length >= MIN_PAIRED_MONTHS ? observedAnnual : configured.annualReturn);
    const annualVolatility =
      asset === "fixed"
        ? configured.annualVolatility
        : values.length >= MIN_PAIRED_MONTHS
          ? observedVolatility
          : configured.annualVolatility;
    const base = {
      annualReturn,
      annualVolatility,
      observations: values.length,
      observed: values.length >= MIN_PAIRED_MONTHS || officialFixed !== null,
      assumptionVersion: MODEL_ASSUMPTION_VERSION,
    };
    model[asset] = base;
    ewmaModel[asset] = { ...base, annualVolatility: ewmaVolatility ?? annualVolatility };
  });
  return {
    model,
    ewmaModel,
    historical,
    referenceAnnualReturn: currentFixedReturn(market),
    covariance: covarianceMatrix(historical.rows, ASSET_KEYS, model),
  };
}

export function walkForwardValidation(market, assumptions = DEFAULT_ASSUMPTIONS) {
  const historical = buildHistoricalReturns(market, assumptions);
  const diagnostics = {};
  ASSET_KEYS.forEach((asset) => {
    const observedRows = historical.rows.filter((row) => row.observed[asset]);
    const losses = { sample: [], ewma: [] };
    const coverage = { gaussian: 0, ewma: 0, bootstrap: 0 };
    let forecasts = 0;
    for (let index = MIN_PAIRED_MONTHS; index < observedRows.length; index += 1) {
      const training = observedRows.slice(index - MIN_PAIRED_MONTHS, index).map((row) => row.returns[asset]);
      const actual = observedRows[index].returns[asset];
      const expected = mean(training);
      const sampleVolatility = standardDeviation(training);
      const weightedVolatility = exponentiallyWeightedVolatility(training, EWMA_HALF_LIFE_MONTHS) / Math.sqrt(12);
      const realizedVariance = (actual - expected) ** 2;
      losses.sample.push(Math.abs(realizedVariance - sampleVolatility ** 2));
      losses.ewma.push(Math.abs(realizedVariance - weightedVolatility ** 2));
      if (Math.abs(actual - expected) <= 1.2816 * sampleVolatility) coverage.gaussian += 1;
      if (Math.abs(actual - expected) <= 1.2816 * weightedVolatility) coverage.ewma += 1;
      if (actual >= percentile(training, 0.1) && actual <= percentile(training, 0.9)) coverage.bootstrap += 1;
      forecasts += 1;
    }
    const baselineLoss = mean(losses.sample);
    const ewmaLoss = mean(losses.ewma);
    const gaussianCoverage = forecasts ? coverage.gaussian / forecasts : null;
    const ewmaCoverage = forecasts ? coverage.ewma / forecasts : null;
    const bootstrapCoverage = forecasts ? coverage.bootstrap / forecasts : null;
    diagnostics[asset] = {
      observations: forecasts,
      available: forecasts >= MIN_WALK_FORWARD_FORECASTS,
      sampleVolatilityLoss: forecasts ? baselineLoss : null,
      ewmaVolatilityLoss: forecasts ? ewmaLoss : null,
      gaussianCoverage,
      ewmaCoverage,
      bootstrapCoverage,
      ewmaEligible:
        forecasts >= MIN_WALK_FORWARD_FORECASTS &&
        ewmaLoss <= baselineLoss &&
        Math.abs(ewmaCoverage - 0.8) <= Math.abs(gaussianCoverage - 0.8),
      bootstrapEligible:
        forecasts >= MIN_WALK_FORWARD_FORECASTS &&
        Math.abs(bootstrapCoverage - 0.8) <= Math.abs(gaussianCoverage - 0.8),
    };
  });
  const eligibleAssets = ASSET_KEYS.filter((asset) => diagnostics[asset].available);
  return {
    available: eligibleAssets.length > 0,
    diagnostics,
    ewmaEligible: eligibleAssets.length > 0 && eligibleAssets.every((asset) => diagnostics[asset].ewmaEligible),
    bootstrapEligible:
      eligibleAssets.length > 0 && eligibleAssets.every((asset) => diagnostics[asset].bootstrapEligible),
  };
}

function exponentiallyWeightedVolatility(values, halfLifeMonths = EWMA_HALF_LIFE_MONTHS) {
  if (values.length < 2) return null;
  const weights = values.map((_, index) => Math.pow(0.5, (values.length - index - 1) / halfLifeMonths));
  const weightTotal = sum(weights);
  const average = sum(values.map((value, index) => value * weights[index])) / weightTotal;
  const variance = sum(values.map((value, index) => weights[index] * (value - average) ** 2)) / weightTotal;
  return Math.sqrt(Math.max(variance, 0) * 12);
}

export function covarianceMatrix(rows, assets = ASSET_KEYS, model = null) {
  return assets.map((rowAsset, rowIndex) =>
    assets.map((columnAsset, columnIndex) => {
      const paired = rows
        .filter((row) => row.observed?.[rowAsset] && row.observed?.[columnAsset])
        .map((row) => [Number(row.returns[rowAsset]), Number(row.returns[columnAsset])])
        .filter(([left, right]) => Number.isFinite(left) && Number.isFinite(right));
      const rowVolatility = Math.max(0, Number(model?.[rowAsset]?.annualVolatility) || 0) / Math.sqrt(12);
      const columnVolatility = Math.max(0, Number(model?.[columnAsset]?.annualVolatility) || 0) / Math.sqrt(12);
      if (rowIndex === columnIndex) {
        if (paired.length < MIN_PAIRED_MONTHS) return rowVolatility ** 2;
        const values = paired.map(([value]) => value);
        return standardDeviation(values) ** 2;
      }
      if (paired.length < 2) return 0;
      const leftValues = paired.map(([left]) => left);
      const rightValues = paired.map(([, right]) => right);
      const leftDeviation = standardDeviation(leftValues);
      const rightDeviation = standardDeviation(rightValues);
      if (leftDeviation <= EPSILON || rightDeviation <= EPSILON) return 0;
      const leftMean = mean(leftValues);
      const rightMean = mean(rightValues);
      const correlation =
        mean(paired.map(([left, right]) => (left - leftMean) * (right - rightMean))) / (leftDeviation * rightDeviation);
      const shrinkage = Math.min(1, paired.length / MIN_PAIRED_MONTHS);
      return clamp(correlation, -1, 1) * shrinkage * rowVolatility * columnVolatility;
    }),
  );
}

function cholesky(matrix) {
  const size = matrix.length;
  const lower = Array.from({ length: size }, () => Array(size).fill(0));
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let value = matrix[row][column];
      for (let index = 0; index < column; index += 1) value -= lower[row][index] * lower[column][index];
      if (row === column) lower[row][column] = Math.sqrt(Math.max(value, 0));
      else lower[row][column] = lower[column][column] > EPSILON ? value / lower[column][column] : 0;
    }
  }
  return lower;
}

function gaussian(random = Math.random) {
  let u = 0;
  let v = 0;
  while (u <= EPSILON) u = random();
  while (v <= EPSILON) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function monthlyContributionAt(base, growth, month) {
  return Math.max(0, Number(base) || 0) * Math.pow(1 + (Number(growth) || 0), Math.floor(month / 12));
}

function applyReturns(holdings, returns) {
  ASSET_KEYS.forEach((asset) => {
    holdings[asset] *= 1 + clamp(Number(returns[asset]) || 0, -0.95, 10);
  });
}

function addContribution(holdings, amount, allocation) {
  ASSET_KEYS.forEach((asset) => {
    holdings[asset] += (amount * (Number(allocation[asset]) || 0)) / 100;
  });
}

function rebalance(holdings, allocation) {
  const total = sum(Object.values(holdings));
  if (total <= EPSILON) return;
  ASSET_KEYS.forEach((asset) => {
    holdings[asset] = (total * (Number(allocation[asset]) || 0)) / 100;
  });
}

function portfolioTotal(holdings) {
  return sum(Object.values(holdings));
}

export function simulatePlan(options = {}) {
  const horizonYears = clamp(options.horizonYears || 5, 1, 50);
  const months = Math.max(1, Math.round(horizonYears * 12));
  const allocation = normalizeAllocation(options.allocation);
  const annualReturns = options.annualReturns || DEFAULT_ASSUMPTIONS;
  const inflationRate = Math.max(-0.99, Number(options.inflationRate) || 0);
  const holdings = Object.fromEntries(ASSET_KEYS.map((asset) => [asset, 0]));
  let totalInvested = Math.max(0, Number(options.initialInvestment) || 0);
  addContribution(holdings, totalInvested, allocation);
  const points = [{ month: 0, nominal: portfolioTotal(holdings), real: portfolioTotal(holdings) }];

  for (let month = 0; month < months; month += 1) {
    const contribution = monthlyContributionAt(options.monthlyContribution, options.contributionGrowth, month);
    totalInvested += contribution;
    addContribution(holdings, contribution, allocation);
    const monthlyReturns = {};
    ASSET_KEYS.forEach((asset) => {
      monthlyReturns[asset] = annualToMonthlyRate(annualReturns[asset]?.annualReturn ?? annualReturns[asset] ?? 0);
    });
    applyReturns(holdings, monthlyReturns);
    if (options.rebalance !== false) rebalance(holdings, allocation);
    const nominal = portfolioTotal(holdings);
    points.push({ month: month + 1, nominal, real: realValue(nominal, inflationRate, (month + 1) / 12) });
  }

  const final = points[points.length - 1];
  return {
    points,
    holdings,
    months,
    horizonYears,
    totalInvested,
    finalValue: final.nominal,
    finalRealValue: final.real,
    nominalGain: final.nominal - totalInvested,
    realGain: final.real - totalInvested,
    maxDrawdown: maxDrawdown(points.map((point) => point.nominal)),
  };
}

function irr(cashFlows) {
  let rate = 0.01;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    let value = 0;
    let derivative = 0;
    cashFlows.forEach((cashFlow, month) => {
      const denominator = Math.pow(1 + rate, month);
      value += cashFlow / denominator;
      if (month > 0) derivative -= (month * cashFlow) / Math.pow(1 + rate, month + 1);
    });
    if (Math.abs(derivative) < EPSILON) break;
    const next = rate - value / derivative;
    if (!Number.isFinite(next) || next <= -0.99 || next > 10) break;
    if (Math.abs(next - rate) < 1e-8) return next;
    rate = next;
  }
  return null;
}

function pathMetrics(values, contributions, inflationRate, monthlyReturns = [], referenceAnnualReturn = null) {
  const months = Math.max(1, values.length - 1);
  const cashFlows = contributions.map((amount) => -amount);
  cashFlows[cashFlows.length - 1] += values[values.length - 1];
  const monthlyIrr = irr(cashFlows);
  const cagr =
    monthlyIrr === null
      ? Math.pow(values[values.length - 1] / Math.max(sum(contributions), EPSILON), 12 / months) - 1
      : Math.pow(1 + monthlyIrr, 12) - 1;
  const finalRealValue = realValue(values[values.length - 1], inflationRate, months / 12);
  return {
    totalInvested: sum(contributions),
    finalValue: values[values.length - 1],
    finalRealValue,
    cagr,
    inflationAdjustedReturn: finalRealValue / Math.max(sum(contributions), EPSILON) - 1,
    maxDrawdown: maxDrawdown(values),
    volatility: annualizedVolatility(monthlyReturns),
    sortino: sortinoRatio(monthlyReturns),
    sharpe:
      Number.isFinite(referenceAnnualReturn) && monthlyReturns.length >= 2
        ? (monthlyToAnnualRate(mean(monthlyReturns)) - referenceAnnualReturn) /
          Math.max(annualizedVolatility(monthlyReturns), EPSILON)
        : null,
    months,
  };
}

export function backtestHistorical(options = {}) {
  const assumptions = options.assumptions || DEFAULT_ASSUMPTIONS;
  const historical = buildHistoricalReturns(options.market, assumptions);
  const requestedMonths = Math.max(6, Math.round(clamp(options.horizonYears || 5, 1, 50) * 12));
  const allocation = normalizeAllocation(options.allocation);
  const requiredAssets = ASSET_KEYS.filter((asset) => allocation[asset] > EPSILON);
  const horizon = requestedMonths;
  const unobservedAssets = requiredAssets.filter(
    (asset) => !historical.rows.length || historical.rows.some((row) => !row.observed[asset]),
  );
  if (historical.rows.length < horizon)
    return {
      available: false,
      reason: "insufficient-observed-history",
      observations: historical.rows.length,
      requiredMonths: horizon,
      coverage: historical.coverage,
      unobservedAssets,
      estimated: false,
    };
  const periods = [];

  for (let start = 0; start + horizon <= historical.rows.length; start += 1) {
    const observedWindow = historical.rows.slice(start, start + horizon);
    const fullyObserved =
      observedWindow.every((row) => requiredAssets.every((asset) => row.observed[asset])) &&
      observedWindow.slice(1).every((row, index) => {
        const previousMonth = observedWindow[index].month;
        const [previousYear, previousMonthNumber] = previousMonth.split("-").map(Number);
        const [currentYear, currentMonthNumber] = row.month.split("-").map(Number);
        return currentYear * 12 + currentMonthNumber === previousYear * 12 + previousMonthNumber + 1;
      });
    if (!fullyObserved) continue;
    const holdings = Object.fromEntries(ASSET_KEYS.map((asset) => [asset, 0]));
    const values = [Math.max(0, Number(options.initialInvestment) || 0)];
    const contributions = [Math.max(0, Number(options.initialInvestment) || 0)];
    const monthlyReturns = [];
    addContribution(holdings, contributions[0], allocation);
    for (let offset = 0; offset < horizon; offset += 1) {
      const contribution = monthlyContributionAt(options.monthlyContribution, options.contributionGrowth, offset);
      addContribution(holdings, contribution, allocation);
      contributions.push(contribution);
      const valueBeforeReturn = portfolioTotal(holdings);
      applyReturns(holdings, observedWindow[offset].returns);
      if (valueBeforeReturn > EPSILON) monthlyReturns.push(portfolioTotal(holdings) / valueBeforeReturn - 1);
      if (options.rebalance !== false) rebalance(holdings, allocation);
      values.push(portfolioTotal(holdings));
    }
    periods.push({
      start: observedWindow[0].month,
      end: observedWindow.at(-1).month,
      ...pathMetrics(
        values,
        contributions,
        Number(options.inflationRate) || 0,
        monthlyReturns,
        currentFixedReturn(options.market),
      ),
    });
  }

  if (!periods.length)
    return {
      available: false,
      reason: "insufficient-observed-history",
      observations: historical.rows.length,
      requiredMonths: horizon,
      coverage: historical.coverage,
      unobservedAssets,
      estimated: false,
    };
  const best = periods.slice().sort((left, right) => right.cagr - left.cagr)[0];
  const worst = periods.slice().sort((left, right) => left.cagr - right.cagr)[0];
  return {
    available: periods.length > 0,
    observations: historical.rows.length,
    coverage: historical.coverage,
    estimated: false,
    referenceAnnualReturn: currentFixedReturn(options.market),
    horizonMonths: horizon,
    periods,
    best,
    worst,
    median: {
      finalValue: median(periods.map((period) => period.finalValue)),
      cagr: median(periods.map((period) => period.cagr)),
      inflationAdjustedReturn: median(periods.map((period) => period.inflationAdjustedReturn)),
      maxDrawdown: median(periods.map((period) => period.maxDrawdown)),
      volatility: median(periods.map((period) => period.volatility)),
      sortino: median(periods.map((period) => period.sortino)),
      sharpe: median(periods.map((period) => period.sharpe)),
    },
  };
}

export function contributionRebalance(
  currentHoldings,
  targetAllocation,
  monthlyContribution,
  assetKeys = PLAN_ASSET_KEYS,
) {
  const contribution = Math.max(0, Number(monthlyContribution) || 0);
  const current = Object.fromEntries(
    assetKeys.map((asset) => [asset, Math.max(0, Number(currentHoldings && currentHoldings[asset]) || 0)]),
  );
  const target = normalizeAllocation(targetAllocation, DEFAULT_ALLOCATION, assetKeys);
  const currentTotal = portfolioTotal(current);
  const currentWeights = Object.fromEntries(
    assetKeys.map((asset) => [asset, currentTotal > EPSILON ? (current[asset] / currentTotal) * 100 : 0]),
  );
  const drift = Object.fromEntries(assetKeys.map((asset) => [asset, currentWeights[asset] - target[asset]]));
  if (currentTotal <= EPSILON)
    return {
      amounts: assetKeys.reduce((result, asset) => ({ ...result, [asset]: (contribution * target[asset]) / 100 }), {}),
      weights: target,
      current,
      currentTotal,
      currentWeights,
      drift,
    };

  const desiredAfterContribution = currentTotal + contribution;
  const deficits = {};
  assetKeys.forEach((asset) => {
    deficits[asset] = Math.max(0, (desiredAfterContribution * target[asset]) / 100 - current[asset]);
  });
  const deficitTotal = sum(Object.values(deficits));
  const amounts = {};
  assetKeys.forEach((asset) => {
    amounts[asset] =
      deficitTotal > EPSILON ? (contribution * deficits[asset]) / deficitTotal : (contribution * target[asset]) / 100;
  });
  return {
    amounts,
    weights: normalizeAllocation(amounts, DEFAULT_ALLOCATION, assetKeys),
    current,
    currentTotal,
    currentWeights,
    drift,
  };
}

function correlatedDraws(model, covariance, random) {
  const assets = ASSET_KEYS;
  const standard = assets.map(() => gaussian(random));
  const rows = assets.map((asset) => [annualToMonthlyRate(model[asset].annualReturn)]);
  const hasCovariance = Array.isArray(covariance) && covariance.length >= assets.length;
  const monthlyCovariance = assets.map((row, rowIndex) =>
    assets.map((asset, columnIndex) => {
      const supplied = Number(covariance?.[rowIndex]?.[columnIndex]);
      if (hasCovariance && Number.isFinite(supplied)) return supplied;
      const first = model[assets[rowIndex]].annualVolatility / Math.sqrt(12);
      const second = model[assets[columnIndex]].annualVolatility / Math.sqrt(12);
      return rowIndex === columnIndex ? first * second : 0;
    }),
  );
  const lower = cholesky(monthlyCovariance);
  return Object.fromEntries(
    assets.map((asset, row) => [asset, rows[row][0] + sum(lower[row].map((value, index) => value * standard[index]))]),
  );
}

function bootstrapDraws(rows, model, random, cursor) {
  if (!rows.length) return null;
  if (cursor.remaining <= 0) {
    const blockLength = Math.min(BOOTSTRAP_BLOCK_MONTHS, rows.length);
    cursor.index = Math.floor(random() * (rows.length - blockLength + 1));
    cursor.remaining = blockLength;
  }
  const row = rows[cursor.index];
  cursor.index += 1;
  cursor.remaining -= 1;
  return Object.fromEntries(
    ASSET_KEYS.map((asset) => [
      asset,
      row.observed?.[asset] && model[asset]?.observed
        ? row.returns[asset]
        : annualToMonthlyRate(model[asset].annualReturn),
    ]),
  );
}

function createSeededRandom(seed = 1) {
  let state = Number(seed) >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

export function runMonteCarlo(options = {}) {
  const paths = Math.round(clamp(options.paths || 2000, 1000, 10000));
  const horizonYears = clamp(options.horizonYears || 5, 1, 50);
  const allocation = normalizeAllocation(options.allocation);
  const modelResult = options.returnModel
    ? {
        model: options.returnModel,
        ewmaModel: options.ewmaModel || options.returnModel,
        historical: options.historical || null,
        covariance:
          options.covariance ||
          (options.historical ? covarianceMatrix(options.historical.rows, ASSET_KEYS, options.returnModel) : null),
        referenceAnnualReturn: options.referenceAnnualReturn ?? null,
      }
    : estimateReturnModel(options.market, options.assumptions || DEFAULT_ASSUMPTIONS);
  const method = ["ewma", "block-bootstrap"].includes(options.method) ? options.method : "gaussian";
  const selectedModel = method === "ewma" ? modelResult.ewmaModel || modelResult.model : modelResult.model;
  const covariance =
    method === "ewma" && modelResult.historical
      ? covarianceMatrix(modelResult.historical.rows, ASSET_KEYS, selectedModel)
      : modelResult.covariance;
  const random = typeof options.random === "function" ? options.random : Math.random;
  const finals = [];
  const realFinals = [];
  const drawdowns = [];
  const volatilities = [];
  const sortinos = [];
  const sharpes = [];
  const goalTarget = Number(options.goalTarget);
  const targetNominal =
    Number.isFinite(goalTarget) && goalTarget > 0
      ? goalTarget * Math.pow(1 + Math.max(-0.99, Number(options.inflationRate) || 0), horizonYears)
      : null;
  let successfulGoals = 0;

  for (let path = 0; path < paths; path += 1) {
    const holdings = Object.fromEntries(ASSET_KEYS.map((asset) => [asset, 0]));
    const monthlyReturns = [];
    const bootstrapCursor = { index: 0, remaining: 0 };
    let totalInvested = Math.max(0, Number(options.initialInvestment) || 0);
    addContribution(holdings, totalInvested, allocation);
    const values = [portfolioTotal(holdings)];
    for (let month = 0; month < Math.round(horizonYears * 12); month += 1) {
      const contribution = monthlyContributionAt(options.monthlyContribution, options.contributionGrowth, month);
      totalInvested += contribution;
      addContribution(holdings, contribution, allocation);
      const valueBeforeReturn = portfolioTotal(holdings);
      const returns =
        method === "block-bootstrap"
          ? bootstrapDraws(modelResult.historical?.rows || [], selectedModel, random, bootstrapCursor) ||
            correlatedDraws(selectedModel, covariance, random)
          : correlatedDraws(selectedModel, covariance, random);
      applyReturns(holdings, returns);
      if (valueBeforeReturn > EPSILON) monthlyReturns.push(portfolioTotal(holdings) / valueBeforeReturn - 1);
      if (options.rebalance !== false) rebalance(holdings, allocation);
      values.push(portfolioTotal(holdings));
    }
    finals.push(values[values.length - 1]);
    if (targetNominal !== null && values[values.length - 1] >= targetNominal) successfulGoals += 1;
    realFinals.push(realValue(values[values.length - 1], Number(options.inflationRate) || 0, horizonYears));
    drawdowns.push(maxDrawdown(values));
    volatilities.push(annualizedVolatility(monthlyReturns));
    sortinos.push(sortinoRatio(monthlyReturns));
    if (Number.isFinite(modelResult.referenceAnnualReturn) && monthlyReturns.length >= 2) {
      sharpes.push(
        (monthlyToAnnualRate(mean(monthlyReturns)) - modelResult.referenceAnnualReturn) /
          Math.max(annualizedVolatility(monthlyReturns), EPSILON),
      );
    }
  }

  return {
    paths,
    horizonYears,
    method,
    modelVersion:
      method === "block-bootstrap"
        ? BOOTSTRAP_MODEL_VERSION
        : method === "ewma"
          ? "mc-ewma-v1"
          : MONTE_CARLO_MODEL_VERSION,
    nominal: { p10: percentile(finals, 0.1), p50: percentile(finals, 0.5), p90: percentile(finals, 0.9) },
    real: { p10: percentile(realFinals, 0.1), p50: percentile(realFinals, 0.5), p90: percentile(realFinals, 0.9) },
    maxDrawdown: { p10: percentile(drawdowns, 0.1), p50: percentile(drawdowns, 0.5), p90: percentile(drawdowns, 0.9) },
    volatility: percentile(volatilities, 0.5),
    sortino: percentile(sortinos, 0.5),
    sharpe: percentile(sharpes, 0.5),
    goalProbability: targetNominal === null ? null : successfulGoals / paths,
    goalTargetNominal: targetNominal,
    historicalObservations: modelResult.historical ? modelResult.historical.observations : 0,
    estimated: modelResult.historical ? modelResult.historical.estimated : true,
    model: selectedModel,
  };
}

export function evaluateGoal(options = {}) {
  const targetToday = Math.max(0, Number(options.targetToday) || 0);
  const horizonYears = clamp(options.horizonYears || 0, 0.25, 50);
  const desiredProbability = clamp(options.desiredProbability ?? 0.75, 0.5, 0.99);
  if (targetToday <= 0 || !horizonYears) return { available: false, reason: "invalid-goal" };

  const seed = Number(options.seed) || 42;
  const paths = Math.round(clamp(options.paths || 1000, 1000, 5000));
  const common = { ...options, paths, horizonYears, goalTarget: targetToday };
  const runAtContribution = (monthlyContribution) =>
    runMonteCarlo({
      ...common,
      monthlyContribution,
      random: createSeededRandom(seed),
    });
  const current = runAtContribution(Math.max(0, Number(options.monthlyContribution) || 0));
  let low = 0;
  let high = Math.max(Number(options.monthlyContribution) || 0, targetToday / (horizonYears * 12), 1);
  let upper = runAtContribution(high);
  let attempts = 0;
  while ((upper.goalProbability || 0) < desiredProbability && attempts < 12) {
    high *= 2;
    upper = runAtContribution(high);
    attempts += 1;
  }
  const feasible = (upper.goalProbability || 0) >= desiredProbability;
  if (feasible) {
    for (let iteration = 0; iteration < 18; iteration += 1) {
      const midpoint = (low + high) / 2;
      const candidate = runAtContribution(midpoint);
      if ((candidate.goalProbability || 0) >= desiredProbability) high = midpoint;
      else low = midpoint;
    }
  }
  return {
    available: true,
    targetToday,
    targetNominal: current.goalTargetNominal,
    horizonYears,
    desiredProbability,
    successProbability: current.goalProbability,
    outcomes: current.nominal,
    requiredMonthlyContribution: feasible ? high : null,
    feasible,
    modelVersion: current.modelVersion,
    modelAssumptionVersion: current.model?.fixed?.assumptionVersion || MODEL_ASSUMPTION_VERSION,
    estimated: current.estimated,
    historicalObservations: current.historicalObservations,
  };
}

export function portfolioFromHistory(history, currentMarket, now = Date.now()) {
  const categories = Object.fromEntries(
    PLAN_ASSET_KEYS.map((asset) => [asset, { invested: 0, value: 0, priced: 0, entries: 0 }]),
  );
  const current = currentMarket && currentMarket.assets ? currentMarket.assets : {};
  let totalInvested = 0;
  (Array.isArray(history) ? history : []).forEach((entry) => {
    const total = Math.max(0, Number(entry.total) || 0);
    totalInvested += total;
    PLAN_ASSET_KEYS.forEach((asset) => {
      const invested = (total * (Number(entry.weights && entry.weights[asset]) || 0)) / 100;
      categories[asset].invested += invested;
      categories[asset].entries += invested > 0 ? 1 : 0;
      if (asset === "fixed") {
        const annual = Number(
          currentMarket?.funds?.fixedIncome?.effectiveAnnualReturn ??
            entry.marketSnapshot?.funds?.fixedIncome?.effectiveAnnualReturn,
        );
        const days = Math.max(0, (now - new Date(entry.createdAt).getTime()) / (24 * 60 * 60 * 1000));
        categories[asset].value += Number.isFinite(annual)
          ? invested * Math.pow(1 + Math.max(-0.9, annual / 100), days / 365)
          : invested;
        categories[asset].priced += Number.isFinite(annual) ? 1 : 0;
        return;
      }
      const marketKey = asset === "currency" ? "dollar" : asset;
      const entryPrice = Number(entry.marketSnapshot?.assets?.[marketKey]?.price);
      const currentPrice = Number(current?.[marketKey]?.price);
      if (entryPrice > 0 && currentPrice > 0) {
        categories[asset].value += (invested * currentPrice) / entryPrice;
        categories[asset].priced += 1;
      } else categories[asset].value += invested;
    });
  });
  const currentValue = sum(Object.values(categories).map((category) => category.value));
  return { totalInvested, currentValue, gain: currentValue - totalInvested, categories };
}
