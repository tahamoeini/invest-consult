import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSET_KEYS,
  DEFAULT_ALLOCATION,
  DEFAULT_ASSUMPTIONS,
  DEFAULT_TRANSACTION_COSTS,
  annualToMonthlyRate,
  annualizedVolatility,
  buildHistoricalReturns,
  contributionRebalance,
  covarianceMatrix,
  downsideDeviation,
  estimateReturnModel,
  mean,
  maxDrawdown,
  monthlyToAnnualRate,
  normalizeAllocation,
  realReturn,
  realValue,
  runMonteCarlo,
  simulatePlan,
  sortinoRatio,
  sharpeRatio,
  standardDeviation,
  recommendAllocation,
} from "../src/engine.js";

const noCosts = Object.fromEntries(ASSET_KEYS.map((asset) => [asset, { buyFee: 0, sellFee: 0, spread: 0 }]));

function monthlyPrices(months, returnAt, metadata = {}) {
  const points = [];
  let value = 100;
  for (let index = 0; index < months; index += 1) {
    if (index > 0) value *= 1 + returnAt(index - 1);
    points.push({
      date: new Date(Date.UTC(2020, index, 1)).toISOString(),
      value,
      currency: "TOMAN",
      source: "deterministic test fixture",
      ...metadata,
    });
  }
  return points;
}

function referenceMarket(months = 60) {
  return {
    funds: { fixedIncome: { effectiveAnnualReturn: 40 } },
    history: {
      gold: monthlyPrices(months, (month) => 0.006 + 0.035 * Math.sin(month * 0.54) + 0.006 * Math.sin(month * 0.31)),
      silver: monthlyPrices(months, (month) => 0.008 + 0.055 * Math.sin(month * 0.54 + 0.18)),
      copper: monthlyPrices(months, (month) => 0.004 + 0.045 * Math.sin(month * 0.29 + 0.85), {
        conversion: { formula: "USD × USD/TOMAN", dollarObservedAt: "same-date" },
      }),
    },
  };
}

function assertFiniteTree(value, path = "result") {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${path} must be finite`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertFiniteTree(child, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, child]) => assertFiniteTree(child, `${path}.${key}`));
  }
}

function independentMonthlyIrr(cashFlows) {
  const npv = (rate) => cashFlows.reduce((value, flow, month) => value + flow / (1 + rate) ** month, 0);
  let low = -0.99;
  let high = 1;
  assert.ok(npv(low) * npv(high) <= 0, "the independent fixture must bracket one IRR");
  for (let iteration = 0; iteration < 160; iteration += 1) {
    const middle = (low + high) / 2;
    if (npv(middle) > 0) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

test("reference 53/31/10/6 portfolio runs 10,000 seeded, quarterly historical-bootstrap paths", () => {
  const market = referenceMarket();
  const allocation = { fixed: 53, gold: 31, silver: 10, copper: 6 };
  const normalized = normalizeAllocation(allocation, DEFAULT_ALLOCATION, ASSET_KEYS);
  assert.equal(
    Object.values(normalized).reduce((total, weight) => total + weight, 0),
    100,
  );
  const history = buildHistoricalReturns(market);
  const estimated = estimateReturnModel(market);
  assert.ok(history.assetMetadata.copper.returnObservations >= 24);
  assert.equal(history.assetMetadata.copper.classification.startsWith("C."), true);
  assert.equal(history.assetMetadata.copper.proxy, true);
  assert.ok(estimated.covariance[ASSET_KEYS.indexOf("copper")][ASSET_KEYS.indexOf("copper")] > 0);

  const simulation = runMonteCarlo({
    market,
    allocation,
    initialInvestment: 210_000_000,
    monthlyContribution: 0,
    horizonYears: 2,
    inflationRate: 0.72,
    paths: 10_000,
    rebalance: true,
    rebalanceCadence: "quarterly",
    method: "block-bootstrap",
    fixedIncomeMode: "constant-market",
    currentFixedAnnualReturn: 0.4,
    transactionCosts: DEFAULT_TRANSACTION_COSTS,
    seed: 20260925,
  });
  const inflationFactor = (1 + 0.72) ** 2;

  assert.equal(simulation.paths, 10_000);
  assert.equal(simulation.seed, 20260925);
  assert.equal(simulation.method, "block-bootstrap");
  assert.equal(simulation.inflationFactor, inflationFactor);
  assert.ok(simulation.dataQuality.jointObservations >= 24);
  assert.equal(
    simulation.dataQuality.assets.find((asset) => asset.assetId === "copper").classification.startsWith("C."),
    true,
  );
  assert.ok(
    simulation.dataQuality.correlationPairs.some(
      (pair) => pair.assets.includes("copper") && pair.source === "paired-historical",
    ),
  );
  assert.ok(simulation.transactionCosts.p50 > 0);
  assert.ok(simulation.transactionCosts.rebalancingTurnoverP50 > 0);
  assert.ok(simulation.nominal.p10 <= simulation.nominal.p50);
  assert.ok(simulation.nominal.p50 <= simulation.nominal.p90);
  assert.ok(simulation.real.p10 <= simulation.real.p50);
  assert.ok(simulation.real.p50 <= simulation.real.p90);
  for (const percentile of ["p10", "p50", "p90"]) {
    assert.ok(simulation.real[percentile] < simulation.nominal[percentile]);
    assert.ok(Math.abs(simulation.real[percentile] - simulation.nominal[percentile] / inflationFactor) < 1e-5);
  }
  assertFiniteTree(simulation);
});

test("monthly return history excludes the unfinished as-of month", () => {
  const market = {
    updatedAt: "2026-09-25T12:00:00.000Z",
    history: {
      gold: [
        { date: "2026-07-31T12:00:00.000Z", value: 100, currency: "TOMAN" },
        { date: "2026-08-31T12:00:00.000Z", value: 110, currency: "TOMAN" },
        { date: "2026-09-25T12:00:00.000Z", value: 121, currency: "TOMAN" },
      ],
    },
  };
  const history = buildHistoricalReturns(market);

  assert.equal(history.excludedPartialMonth, "2026-09");
  assert.equal(history.latestDate, "2026-08");
  assert.equal(history.assetMetadata.gold.returnObservations, 1);
  assert.equal(history.assetMetadata.gold.partialMonthExcluded, true);
  assert.ok(Math.abs(history.rows[0].returns.gold - 0.1) < 1e-12);
});

test("Monte Carlo paths are reproducible for the same seed and inputs", () => {
  const options = {
    allocation: { gold: 60, silver: 40 },
    initialInvestment: 10_000,
    monthlyContribution: 0,
    horizonYears: 2,
    inflationRate: 0.72,
    paths: 1_000,
    rebalance: false,
    transactionCosts: noCosts,
    seed: 88_521,
  };
  assert.deepEqual(runMonteCarlo(options), runMonteCarlo(options));
});

test("100% fixed income compounds a 40% effective annual yield to the same annual value", () => {
  const monthlyRate = annualToMonthlyRate(0.4);
  assert.ok(Math.abs((1 + monthlyRate) ** 12 - 1.4) < 1e-12);
  assert.ok(Math.abs(monthlyRate - 0.028436) < 1e-6);

  const plan = simulatePlan({
    initialInvestment: 210_000_000,
    monthlyContribution: 0,
    horizonYears: 1,
    allocation: { fixed: 100 },
    annualReturns: { ...DEFAULT_ASSUMPTIONS, fixed: { annualReturn: 0.25, annualVolatility: 0 } },
    fixedIncomeMode: "constant-market",
    currentFixedAnnualReturn: 0.4,
    rebalance: true,
    rebalanceCadence: "quarterly",
  });
  assert.ok(Math.abs(plan.finalValue - 210_000_000 * 1.4) < 1e-5);
  assert.equal(plan.transactionCosts, 0);
});

test("100% gold includes its market-hours purchase fee and compounds a deterministic return", () => {
  const plan = simulatePlan({
    initialInvestment: 1_000,
    monthlyContribution: 0,
    horizonYears: 1,
    allocation: { gold: 100 },
    annualReturns: { ...DEFAULT_ASSUMPTIONS, gold: { annualReturn: 0.2, annualVolatility: 0 } },
    rebalance: false,
    transactionCosts: DEFAULT_TRANSACTION_COSTS,
  });
  assert.ok(Math.abs(plan.finalValue - 1_000 * 0.995 * 1.2) < 1e-9);
  assert.equal(plan.transactionCosts, 5);
  assert.equal(plan.rebalancingTurnover, 0);
});

test("Fisher real return, two-year inflation, and zero-inflation cases are exact", () => {
  assert.ok(Math.abs(realReturn(0.4, 0.72) - (1.4 / 1.72 - 1)) < 1e-12);
  assert.equal(realValue(210_000_000, 0.72, 2), 210_000_000 / 1.72 ** 2);
  assert.equal(realValue(210_000_000, 0, 2), 210_000_000);
  assert.ok(Math.abs(realReturn(0.4, 0) - 0.4) < 1e-12);
  assert.equal(realValue(null, 0.72, 2), null);
  assert.equal(realValue(-1, 0.72, 2), null);
});

test("real CAGR solves the inflation-deflated monthly cash-flow stream", () => {
  const inflation = 0.72;
  const plan = simulatePlan({
    initialInvestment: 100_000,
    monthlyContribution: 20_000,
    horizonYears: 2,
    inflationRate: inflation,
    allocation: { fixed: 100 },
    fixedIncomeMode: "constant-market",
    currentFixedAnnualReturn: 0.4,
    transactionCosts: noCosts,
    rebalance: false,
  });
  const contributions = [100_000, ...Array(24).fill(20_000)];
  const cashFlows = contributions.map((amount, month) => -amount / (1 + inflation) ** (month / 12));
  cashFlows[cashFlows.length - 1] += plan.finalValue / (1 + inflation) ** 2;
  const expected = (1 + independentMonthlyIrr(cashFlows)) ** 12 - 1;
  assert.ok(Math.abs(plan.realCagr - expected) < 1e-8);
  assert.ok(Math.abs(plan.realCagr - realReturn(plan.cagr, inflation)) < 1e-8);
});

test("Sharpe uses explicitly benchmarked monthly arithmetic excess returns", () => {
  const returns = [0.02, -0.01, 0.015, 0.005, -0.004, 0.03, 0.01, -0.006];
  const benchmarkMonthly = annualToMonthlyRate(0.04);
  const averageExcess = returns.reduce((total, value) => total + value - benchmarkMonthly, 0) / returns.length;
  const deviation = Math.sqrt(
    returns.reduce(
      (total, value) => total + (value - returns.reduce((sum, entry) => sum + entry, 0) / returns.length) ** 2,
      0,
    ) /
      (returns.length - 1),
  );
  assert.ok(
    Math.abs(sharpeRatio(returns, benchmarkMonthly) - (averageExcess * 12) / (deviation * Math.sqrt(12))) < 1e-12,
  );
  assert.equal(sharpeRatio(returns, null), null);
  assert.equal(sharpeRatio(Array(24).fill(0.01), 0), null);
  assert.ok(Math.abs(monthlyToAnnualRate(benchmarkMonthly) - 0.04) < 1e-12);
  assert.equal(mean([]), null);
  assert.equal(annualToMonthlyRate(null), null);
  assert.equal(monthlyToAnnualRate(null), null);
});

test("negative return paths stay nonnegative and high inflation remains finite", () => {
  const loss = simulatePlan({
    initialInvestment: 1_000,
    monthlyContribution: 0,
    horizonYears: 1,
    allocation: { gold: 100 },
    annualReturns: { ...DEFAULT_ASSUMPTIONS, gold: { annualReturn: -0.5, annualVolatility: 0 } },
    rebalance: false,
    transactionCosts: noCosts,
  });
  assert.ok(loss.finalValue >= 0);
  assert.ok(loss.finalValue < 1_000);
  const highInflation = realValue(1_000, 10, 2);
  assert.equal(highInflation, 1_000 / 121);
  assert.ok(Number.isFinite(highInflation));
});

test("high transaction costs are charged on purchases and quarterly rebalancing trades", () => {
  const costs = {
    ...noCosts,
    gold: { buyFee: 0.1, sellFee: 0.1, spread: 0 },
  };
  const inputs = {
    initialInvestment: 10_000,
    monthlyContribution: 0,
    horizonYears: 1,
    allocation: { fixed: 50, gold: 50 },
    annualReturns: {
      ...DEFAULT_ASSUMPTIONS,
      fixed: { annualReturn: 0, annualVolatility: 0 },
      gold: { annualReturn: 0.8, annualVolatility: 0 },
    },
    fixedIncomeMode: "user-expected",
    currentFixedAnnualReturn: 0,
    transactionCosts: costs,
  };
  const noRebalance = simulatePlan({ ...inputs, rebalance: false });
  const quarterly = simulatePlan({ ...inputs, rebalance: true, rebalanceCadence: "quarterly" });
  assert.equal(noRebalance.rebalancingTurnover, 0);
  assert.equal(noRebalance.transactionCosts, 500);
  assert.ok(quarterly.rebalancingTurnover > 0);
  assert.ok(quarterly.transactionCosts > noRebalance.transactionCosts);
  assert.ok(quarterly.finalValue < simulatePlan({ ...inputs, rebalance: false, transactionCosts: noCosts }).finalValue);
});

test("short or missing asset history uses visible assumptions and reports bootstrap fallback", () => {
  const result = runMonteCarlo({
    market: { history: { gold: monthlyPrices(3, () => 0.02) } },
    allocation: { gold: 50, silver: 50 },
    initialInvestment: 1_000,
    monthlyContribution: 0,
    horizonYears: 1,
    paths: 1_000,
    method: "block-bootstrap",
    fixedIncomeMode: "user-expected",
    transactionCosts: noCosts,
    seed: 18,
  });
  assert.equal(result.method, "gaussian");
  assert.equal(result.methodFallbackReason, "insufficient-joint-monthly-history");
  assert.equal(result.historicalObservations, 0);
  assert.ok(result.dataQuality.insufficientHistoryAssets.includes("gold"));
  assert.ok(result.dataQuality.fallbackAssumptionAssets.includes("silver"));
  assert.equal(result.dataQuality.quality, "low");
  assert.equal(result.sortino, null);
  assert.notEqual(result.sortinoStatus, "available");
  assertFiniteTree(result);
});

test("paired covariance retains perfect dependence and uses observed zero covariance when supported", () => {
  const perfect = Array.from({ length: 48 }, (_, index) => {
    const value = index % 2 ? -0.01 : 0.01;
    return { returns: { gold: value, silver: value }, observed: { gold: true, silver: true } };
  });
  const sampleDeviation = standardDeviation(perfect.map((row) => row.returns.gold));
  const model = {
    gold: { annualVolatility: sampleDeviation * Math.sqrt(12) },
    silver: { annualVolatility: sampleDeviation * Math.sqrt(12) },
  };
  const perfectCovariance = covarianceMatrix(perfect, ["gold", "silver"], model);
  assert.ok(Math.abs(perfectCovariance[0][1] - perfectCovariance[0][0]) < 1e-12);

  const uncorrelated = Array.from({ length: 48 }, (_, index) => {
    const pair = [
      [0.01, 0.01],
      [0.01, -0.01],
      [-0.01, 0.01],
      [-0.01, -0.01],
    ][index % 4];
    return { returns: { gold: pair[0], silver: pair[1] }, observed: { gold: true, silver: true } };
  });
  assert.ok(Math.abs(covarianceMatrix(uncorrelated, ["gold", "silver"], model)[0][1]) < 1e-12);
});

test("unused instruments cannot shrink correlations among selected portfolio assets", () => {
  const estimated = estimateReturnModel({});
  const covariance = estimated.covariance.map((row) => row.slice());
  const gold = ASSET_KEYS.indexOf("gold");
  const silver = ASSET_KEYS.indexOf("silver");
  covariance[gold][silver] = 0.8 * Math.sqrt(covariance[gold][gold] * covariance[silver][silver]);
  covariance[silver][gold] = covariance[gold][silver];

  const covarianceWithUnusedConflict = covariance.map((row) => row.slice());
  const unused = ["bitcoin", "ethereum", "tether"].map((asset) => ASSET_KEYS.indexOf(asset));
  const unusedCorrelations = [
    [1, 0.99, -0.99],
    [0.99, 1, 0.99],
    [-0.99, 0.99, 1],
  ];
  unused.forEach((row, rowIndex) => {
    unused.forEach((column, columnIndex) => {
      covarianceWithUnusedConflict[row][column] =
        unusedCorrelations[rowIndex][columnIndex] *
        Math.sqrt(covarianceWithUnusedConflict[row][row] * covarianceWithUnusedConflict[column][column]);
    });
  });

  const options = {
    allocation: { gold: 50, silver: 50 },
    initialInvestment: 10_000,
    monthlyContribution: 0,
    horizonYears: 2,
    paths: 1_000,
    rebalance: false,
    transactionCosts: noCosts,
    returnModel: estimated.model,
    seed: 73,
  };
  const selectedCovariance = runMonteCarlo({ ...options, covariance });
  const conflictedUnused = runMonteCarlo({ ...options, covariance: covarianceWithUnusedConflict });

  assert.deepEqual(conflictedUnused.nominal, selectedCovariance.nominal);
  assert.equal(selectedCovariance.correlationOffDiagonalRetention, 1);
});

test("correlated Monte Carlo paths preserve the portfolio risk difference", () => {
  const model = Object.fromEntries(ASSET_KEYS.map((asset) => [asset, { annualReturn: 0, annualVolatility: 0 }]));
  model.gold.annualVolatility = 0.2;
  model.silver.annualVolatility = 0.2;
  const marketVariance = 0.2 ** 2 / 12;
  const perfect = ASSET_KEYS.map(() => ASSET_KEYS.map(() => 0));
  const independent = perfect.map((row) => row.slice());
  const goldIndex = ASSET_KEYS.indexOf("gold");
  const silverIndex = ASSET_KEYS.indexOf("silver");
  [perfect, independent].forEach((matrix) => {
    matrix[goldIndex][goldIndex] = marketVariance;
    matrix[silverIndex][silverIndex] = marketVariance;
  });
  perfect[goldIndex][silverIndex] = marketVariance;
  perfect[silverIndex][goldIndex] = marketVariance;
  const options = {
    allocation: { gold: 50, silver: 50 },
    initialInvestment: 10_000,
    monthlyContribution: 0,
    horizonYears: 1,
    paths: 1_000,
    returnModel: model,
    fixedIncomeMode: "user-expected",
    transactionCosts: noCosts,
    seed: 21,
  };
  const correlated = runMonteCarlo({ ...options, covariance: perfect });
  const uncorrelated = runMonteCarlo({ ...options, covariance: independent });
  assert.ok(correlated.nominal.p90 - correlated.nominal.p10 > uncorrelated.nominal.p90 - uncorrelated.nominal.p10);
});

test("Sortino is unavailable without enough observations or downside observations", () => {
  assert.equal(downsideDeviation([], 0), null);
  assert.equal(sortinoRatio(Array(24).fill(0.01), 0), null);
  assert.equal(sortinoRatio(Array(24).fill(0), 0), null);
  assert.equal(maxDrawdown([100]), null);
  assert.equal(annualizedVolatility([]), null);
});

test("monthly contributions preferentially fill target gaps without selling", () => {
  const target = { fixed: 53, gold: 31, silver: 10, copper: 6 };
  const result = contributionRebalance(
    { fixed: 1_000, gold: 0, silver: 0, copper: 0 },
    target,
    100,
    ["fixed", "gold", "silver", "copper"],
    { driftThresholdPercent: 3, transactionCosts: noCosts },
  );
  assert.equal(result.usesTargetDrift, true);
  assert.equal(result.amounts.fixed, 0);
  assert.ok(result.amounts.gold > result.amounts.silver);
  assert.ok(result.amounts.silver > result.amounts.copper);
  assert.ok(Math.abs(Object.values(result.amounts).reduce((sum, value) => sum + value, 0) - 100) < 1e-9);
  const largeContribution = contributionRebalance(
    { fixed: 1_000 },
    target,
    10_000,
    ["fixed", "gold", "silver", "copper"],
    { driftThresholdPercent: 3, transactionCosts: noCosts },
  );
  const finalTotal = 1_000 + Object.values(largeContribution.amounts).reduce((sum, value) => sum + value, 0);
  for (const asset of ["fixed", "gold", "silver", "copper"])
    assert.ok(
      Math.abs(
        ((largeContribution.current[asset] + largeContribution.amounts[asset]) / finalTotal) * 100 - target[asset],
      ) < 1e-8,
    );
});

test("conservative recommendation drops micro weights unless the user opts in", () => {
  const profile = { riskTolerance: "conservative", goal: "preservation", horizonYears: 2 };
  const standard = recommendAllocation(profile, { enabledAssets: ["bitcoin", "ethereum", "platinum", "palladium"] });
  assert.equal(
    Object.values(standard.weights).reduce((sum, value) => sum + value, 0),
    100,
  );
  assert.ok(Object.values(standard.weights).every((weight) => weight === 0 || weight >= 3));
  assert.equal(standard.weights.currency, 0);
  assert.equal(standard.weights.bitcoin + standard.weights.ethereum, 0);
  const micro = recommendAllocation(profile, {
    enabledAssets: ["bitcoin", "ethereum"],
    allowMicroAllocation: true,
  });
  assert.ok(micro.weights.bitcoin + micro.weights.ethereum > 0);
});

test("zero or malformed allocations and missing metrics never become plausible zeros", () => {
  assert.throws(() => simulatePlan({ allocation: {}, initialInvestment: 1_000 }), /invalid-allocation/);
  assert.throws(() => runMonteCarlo({ allocation: { gold: -1 }, initialInvestment: 1_000 }), /invalid-allocation/);
  assert.throws(
    () => simulatePlan({ allocation: { gold: 100 }, initialInvestment: 1_000, inflationRate: null }),
    /missing-inflation-rate/,
  );
  assert.equal(maxDrawdown([]), null);
  assert.equal(realReturn(null, 0.72), null);
  const noCapital = runMonteCarlo({
    allocation: { gold: 100 },
    initialInvestment: 0,
    monthlyContribution: 0,
    horizonYears: 1,
    paths: 1_000,
    transactionCosts: noCosts,
    seed: 4,
  });
  assert.equal(noCapital.nominalLossProbability, null);
  assert.equal(noCapital.purchasingPowerLossProbability, null);
  assert.equal(noCapital.probabilityBeatingInflation, null);
  assert.equal(noCapital.volatility, null);
  assert.equal(noCapital.maxDrawdown.p50, null);
});
