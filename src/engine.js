// @ts-check

/**
 * Pure, dependency-free planning and analysis functions.
 *
 * The browser and the test suite use this module. It deliberately contains no
 * DOM, network, storage, or provider-specific code.
 */

export const ASSET_KEYS = ["fixed", "gold", "currency", "silver"];

export const DEFAULT_ALLOCATION = Object.freeze({
  fixed: 72,
  gold: 18,
  currency: 8,
  silver: 2,
});

export const DEFAULT_ASSUMPTIONS = Object.freeze({
  fixed: { annualReturn: 0.25, annualVolatility: 0.04 },
  gold: { annualReturn: 0.25, annualVolatility: 0.24 },
  currency: { annualReturn: 0.25, annualVolatility: 0.22 },
  silver: { annualReturn: 0.28, annualVolatility: 0.34 },
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
  const valid = values.filter(Number.isFinite).slice().sort((left, right) => left - right);
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

export function percentile(values, probability) {
  const valid = values.filter(Number.isFinite).slice().sort((left, right) => left - right);
  if (!valid.length) return null;
  const position = clamp(probability, 0, 1) * (valid.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return valid[lower];
  return valid[lower] + (valid[upper] - valid[lower]) * (position - lower);
}

export function normalizeAllocation(input, fallback = DEFAULT_ALLOCATION) {
  const raw = {};
  ASSET_KEYS.forEach((key) => {
    raw[key] = Math.max(0, Number(input && input[key]) || 0);
  });
  const total = sum(Object.values(raw));
  if (total <= EPSILON) return { ...fallback };
  const normalized = {};
  ASSET_KEYS.forEach((key) => { normalized[key] = (raw[key] / total) * 100; });
  return normalized;
}

export function roundAllocation(input) {
  const normalized = normalizeAllocation(input);
  const rounded = Object.fromEntries(ASSET_KEYS.map((key) => [key, Math.floor(normalized[key])]));
  let remaining = 100 - sum(Object.values(rounded));
  const order = ASSET_KEYS.slice().sort((left, right) => (normalized[right] - rounded[right]) - (normalized[left] - rounded[left]));
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
  return Number(nominalValue || 0) / Math.pow(1 + Math.max(-0.99, Number(inflationRate) || 0), Math.max(0, Number(years) || 0));
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
  return ({ conservative: 0, balanced: 1, growth: 2 }[value] ?? 0);
}

function stabilityValue(value) {
  return ({ unstable: 2, mixed: 1, stable: 0 }[value] ?? 1);
}

function emergencyValue(value) {
  return ({ none: 3, partial: 1, complete: 0 }[value] ?? 1);
}

/**
 * Build a conservative allocation from the user's situation.
 * This is a rule system, not a market forecast.
 */
export function recommendAllocation(profile = {}) {
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
  const weights = roundAllocation({
    fixed,
    gold: nonFixed * goldShare,
    currency: nonFixed * currencyShare,
    silver: Math.max(1, nonFixed * silverShare),
  });

  return {
    weights,
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
    },
  };
}

function extractSeries(market, key) {
  const raw = market && market.history && market.history[key];
  if (!Array.isArray(raw)) return [];
  return raw.map((point) => {
    if (Array.isArray(point)) return { date: point[0], value: Number(point[1]) };
    if (!point || typeof point !== "object") return null;
    return {
      date: point.date || point.time || point.timestamp,
      value: Number(point.value ?? point.price ?? point.close ?? point.c),
    };
  }).filter((point) => point && point.date && Number.isFinite(point.value) && point.value > 0)
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
  return [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([month, point]) => ({ month, value: point.value, date: point.date }));
}

function seriesReturns(series) {
  const monthly = monthlySeries(series);
  return monthly.slice(1).map((point, index) => ({
    month: point.month,
    date: point.date,
    value: point.value / monthly[index].value - 1,
  })).filter((point) => Number.isFinite(point.value) && point.value > -1);
}

/**
 * Convert provider history into aligned monthly returns. Missing assets use
 * the transparent model assumption and are marked as estimated.
 */
export function buildHistoricalReturns(market, assumptions = DEFAULT_ASSUMPTIONS) {
  const marketKeys = { fixed: null, gold: "gold", currency: "dollar", silver: "silver" };
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
      if (asset === "fixed") {
        row.returns[asset] = annualToMonthlyRate(assumptions.fixed.annualReturn);
        row.observed[asset] = false;
        return;
      }
      const point = actual[asset].find((candidate) => candidate.month === month);
      row.returns[asset] = point ? point.value : annualToMonthlyRate(assumptions[asset].annualReturn);
      row.observed[asset] = Boolean(point);
    });
    row.index = index;
    return row;
  });

  const coverage = {};
  ASSET_KEYS.forEach((asset) => {
    coverage[asset] = rows.length ? rows.filter((row) => row.observed[asset]).length / rows.length : 0;
  });
  return { rows, coverage, observations: rows.length, estimated: Object.values(coverage).some((value) => value < 0.75) };
}

function currentFixedReturn(market) {
  const value = market && market.funds && market.funds.fixedIncome && market.funds.fixedIncome.effectiveAnnualReturn;
  return Number.isFinite(Number(value)) ? Number(value) / 100 : null;
}

export function estimateReturnModel(market, assumptions = DEFAULT_ASSUMPTIONS) {
  const historical = buildHistoricalReturns(market, assumptions);
  const model = {};
  ASSET_KEYS.forEach((asset) => {
    const values = historical.rows.map((row) => row.returns[asset]).filter(Number.isFinite);
    const configured = assumptions[asset] || DEFAULT_ASSUMPTIONS[asset];
    const observedAnnual = monthlyToAnnualRate(mean(values));
    const observedVolatility = standardDeviation(values) * Math.sqrt(12);
    const officialFixed = asset === "fixed" ? currentFixedReturn(market) : null;
    model[asset] = {
      annualReturn: officialFixed ?? (historical.coverage[asset] >= 0.5 ? observedAnnual : configured.annualReturn),
      annualVolatility: asset === "fixed" ? configured.annualVolatility : historical.coverage[asset] >= 0.5 ? observedVolatility : configured.annualVolatility,
      observations: values.length,
      observed: historical.coverage[asset] >= 0.5,
    };
  });
  return { model, historical, covariance: covarianceMatrix(historical.rows, ASSET_KEYS) };
}

function covarianceMatrix(rows, assets) {
  const columns = assets.map((asset) => rows.map((row) => Number(row.returns[asset]) || 0));
  const means = columns.map(mean);
  return columns.map((column, rowIndex) => columns.map((other, columnIndex) => {
    if (column.length < 2) return 0;
    return mean(column.map((value, index) => (value - means[rowIndex]) * (other[index] - means[columnIndex])));
  }));
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
  ASSET_KEYS.forEach((asset) => { holdings[asset] += amount * (Number(allocation[asset]) || 0) / 100; });
}

function rebalance(holdings, allocation) {
  const total = sum(Object.values(holdings));
  if (total <= EPSILON) return;
  ASSET_KEYS.forEach((asset) => { holdings[asset] = total * (Number(allocation[asset]) || 0) / 100; });
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
    ASSET_KEYS.forEach((asset) => { monthlyReturns[asset] = annualToMonthlyRate(annualReturns[asset]?.annualReturn ?? annualReturns[asset] ?? 0); });
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
      if (month > 0) derivative -= month * cashFlow / Math.pow(1 + rate, month + 1);
    });
    if (Math.abs(derivative) < EPSILON) break;
    const next = rate - value / derivative;
    if (!Number.isFinite(next) || next <= -0.99 || next > 10) break;
    if (Math.abs(next - rate) < 1e-8) return next;
    rate = next;
  }
  return null;
}

function pathMetrics(values, contributions, inflationRate) {
  const months = Math.max(1, values.length - 1);
  const cashFlows = contributions.map((amount) => -amount);
  cashFlows[cashFlows.length - 1] += values[values.length - 1];
  const monthlyIrr = irr(cashFlows);
  const cagr = monthlyIrr === null ? Math.pow(values[values.length - 1] / Math.max(sum(contributions), EPSILON), 12 / months) - 1 : Math.pow(1 + monthlyIrr, 12) - 1;
  const finalRealValue = realValue(values[values.length - 1], inflationRate, months / 12);
  return {
    totalInvested: sum(contributions),
    finalValue: values[values.length - 1],
    finalRealValue,
    cagr,
    inflationAdjustedReturn: finalRealValue / Math.max(sum(contributions), EPSILON) - 1,
    maxDrawdown: maxDrawdown(values),
    months,
  };
}

export function backtestHistorical(options = {}) {
  const assumptions = options.assumptions || DEFAULT_ASSUMPTIONS;
  const historical = buildHistoricalReturns(options.market, assumptions);
  const requestedMonths = Math.max(6, Math.round(clamp(options.horizonYears || 5, 1, 50) * 12));
  if (historical.rows.length < 6) return { available: false, reason: "insufficient-history", observations: historical.rows.length, coverage: historical.coverage };
  const horizon = Math.min(requestedMonths, historical.rows.length);
  const allocation = normalizeAllocation(options.allocation);
  const periods = [];

  for (let start = 0; start + horizon <= historical.rows.length; start += 1) {
    const holdings = Object.fromEntries(ASSET_KEYS.map((asset) => [asset, 0]));
    const values = [Math.max(0, Number(options.initialInvestment) || 0)];
    const contributions = [Math.max(0, Number(options.initialInvestment) || 0)];
    addContribution(holdings, contributions[0], allocation);
    for (let offset = 0; offset < horizon; offset += 1) {
      const contribution = monthlyContributionAt(options.monthlyContribution, options.contributionGrowth, offset);
      addContribution(holdings, contribution, allocation);
      contributions.push(contribution);
      applyReturns(holdings, historical.rows[start + offset].returns);
      if (options.rebalance !== false) rebalance(holdings, allocation);
      values.push(portfolioTotal(holdings));
    }
    periods.push({
      start: historical.rows[start].month,
      end: historical.rows[start + horizon - 1].month,
      ...pathMetrics(values, contributions, Number(options.inflationRate) || 0),
    });
  }

  const best = periods.slice().sort((left, right) => right.cagr - left.cagr)[0];
  const worst = periods.slice().sort((left, right) => left.cagr - right.cagr)[0];
  return {
    available: periods.length > 0,
    observations: historical.rows.length,
    coverage: historical.coverage,
    estimated: historical.estimated,
    horizonMonths: horizon,
    periods,
    best,
    worst,
    median: {
      finalValue: median(periods.map((period) => period.finalValue)),
      cagr: median(periods.map((period) => period.cagr)),
      inflationAdjustedReturn: median(periods.map((period) => period.inflationAdjustedReturn)),
      maxDrawdown: median(periods.map((period) => period.maxDrawdown)),
    },
  };
}

export function contributionRebalance(currentHoldings, targetAllocation, monthlyContribution) {
  const contribution = Math.max(0, Number(monthlyContribution) || 0);
  const current = Object.fromEntries(ASSET_KEYS.map((asset) => [asset, Math.max(0, Number(currentHoldings && currentHoldings[asset]) || 0)]));
  const target = normalizeAllocation(targetAllocation);
  const currentTotal = portfolioTotal(current);
  if (currentTotal <= EPSILON) return { amounts: ASSET_KEYS.reduce((result, asset) => ({ ...result, [asset]: contribution * target[asset] / 100 }), {}), weights: target, current, currentTotal };

  const desiredAfterContribution = currentTotal + contribution;
  const deficits = {};
  ASSET_KEYS.forEach((asset) => { deficits[asset] = Math.max(0, desiredAfterContribution * target[asset] / 100 - current[asset]); });
  const deficitTotal = sum(Object.values(deficits));
  const amounts = {};
  ASSET_KEYS.forEach((asset) => { amounts[asset] = deficitTotal > EPSILON ? contribution * deficits[asset] / deficitTotal : contribution * target[asset] / 100; });
  return { amounts, weights: normalizeAllocation(amounts), current, currentTotal };
}

function correlatedDraws(model, covariance, random) {
  const assets = ASSET_KEYS;
  const standard = assets.map(() => gaussian(random));
  const rows = assets.map((asset) => [annualToMonthlyRate(model[asset].annualReturn)]);
  const monthlyCovariance = assets.map((row, rowIndex) => assets.map((asset, columnIndex) => {
    const supplied = Number(covariance?.[rowIndex]?.[columnIndex]);
    if (Number.isFinite(supplied) && (supplied !== 0 || rowIndex !== columnIndex)) return supplied;
    const first = model[assets[rowIndex]].annualVolatility / Math.sqrt(12);
    const second = model[assets[columnIndex]].annualVolatility / Math.sqrt(12);
    return rowIndex === columnIndex ? first * second : 0;
  }));
  const lower = cholesky(monthlyCovariance);
  return Object.fromEntries(assets.map((asset, row) => [asset, rows[row][0] + sum(lower[row].map((value, index) => value * standard[index]))]));
}

export function runMonteCarlo(options = {}) {
  const paths = Math.round(clamp(options.paths || 2000, 1000, 10000));
  const horizonYears = clamp(options.horizonYears || 5, 1, 50);
  const allocation = normalizeAllocation(options.allocation);
  const modelResult = options.returnModel ? { model: options.returnModel, historical: options.historical || null, covariance: options.covariance || (options.historical ? covarianceMatrix(options.historical.rows, ASSET_KEYS) : null) } : estimateReturnModel(options.market, options.assumptions || DEFAULT_ASSUMPTIONS);
  const random = typeof options.random === "function" ? options.random : Math.random;
  const finals = [];
  const realFinals = [];
  const drawdowns = [];

  for (let path = 0; path < paths; path += 1) {
    const holdings = Object.fromEntries(ASSET_KEYS.map((asset) => [asset, 0]));
    let totalInvested = Math.max(0, Number(options.initialInvestment) || 0);
    addContribution(holdings, totalInvested, allocation);
    const values = [portfolioTotal(holdings)];
    for (let month = 0; month < Math.round(horizonYears * 12); month += 1) {
      const contribution = monthlyContributionAt(options.monthlyContribution, options.contributionGrowth, month);
      totalInvested += contribution;
      addContribution(holdings, contribution, allocation);
      applyReturns(holdings, correlatedDraws(modelResult.model, modelResult.covariance, random));
      if (options.rebalance !== false) rebalance(holdings, allocation);
      values.push(portfolioTotal(holdings));
    }
    finals.push(values[values.length - 1]);
    realFinals.push(realValue(values[values.length - 1], Number(options.inflationRate) || 0, horizonYears));
    drawdowns.push(maxDrawdown(values));
  }

  return {
    paths,
    horizonYears,
    nominal: { p10: percentile(finals, 0.1), p50: percentile(finals, 0.5), p90: percentile(finals, 0.9) },
    real: { p10: percentile(realFinals, 0.1), p50: percentile(realFinals, 0.5), p90: percentile(realFinals, 0.9) },
    maxDrawdown: { p10: percentile(drawdowns, 0.1), p50: percentile(drawdowns, 0.5), p90: percentile(drawdowns, 0.9) },
    historicalObservations: modelResult.historical ? modelResult.historical.observations : 0,
    estimated: modelResult.historical ? modelResult.historical.estimated : true,
    model: modelResult.model,
  };
}

export function portfolioFromHistory(history, currentMarket, now = Date.now()) {
  const categories = Object.fromEntries(ASSET_KEYS.map((asset) => [asset, { invested: 0, value: 0, priced: 0, entries: 0 }]));
  const current = currentMarket && currentMarket.assets ? currentMarket.assets : {};
  let totalInvested = 0;
  (Array.isArray(history) ? history : []).forEach((entry) => {
    const total = Math.max(0, Number(entry.total) || 0);
    totalInvested += total;
    ASSET_KEYS.forEach((asset) => {
      const invested = total * (Number(entry.weights && entry.weights[asset]) || 0) / 100;
      categories[asset].invested += invested;
      categories[asset].entries += invested > 0 ? 1 : 0;
      if (asset === "fixed") {
        const annual = Number(currentMarket?.funds?.fixedIncome?.effectiveAnnualReturn ?? entry.marketSnapshot?.funds?.fixedIncome?.effectiveAnnualReturn);
        const days = Math.max(0, (now - new Date(entry.createdAt).getTime()) / (24 * 60 * 60 * 1000));
        categories[asset].value += Number.isFinite(annual) ? invested * Math.pow(1 + Math.max(-0.9, annual / 100), days / 365) : invested;
        categories[asset].priced += Number.isFinite(annual) ? 1 : 0;
        return;
      }
      const marketKey = asset === "currency" ? "dollar" : asset;
      const entryPrice = Number(entry.marketSnapshot?.assets?.[marketKey]?.price);
      const currentPrice = Number(current?.[marketKey]?.price);
      if (entryPrice > 0 && currentPrice > 0) {
        categories[asset].value += invested * currentPrice / entryPrice;
        categories[asset].priced += 1;
      } else categories[asset].value += invested;
    });
  });
  const currentValue = sum(Object.values(categories).map((category) => category.value));
  return { totalInvested, currentValue, gain: currentValue - totalInvested, categories };
}
