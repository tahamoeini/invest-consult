import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSET_KEYS,
  backtestHistorical,
  contributionRebalance,
  recommendAllocation,
  runMonteCarlo,
  simulatePlan,
} from "../src/engine.js";
import {
  createHistoryExport,
  mergeHistory,
  parseHistoryExport,
  sanitizeHistoryEntry,
} from "../src/history.js";
import {
  appendTransactions,
  calculatePortfolio,
  createEmptyPortfolio,
  createPortfolioVersion,
  createTransaction,
  portfolioSeries,
} from "../src/portfolio.js";

function series(start = 100, growth = 0.02, count = 36) {
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(Date.UTC(2020 + Math.floor(index / 12), index % 12, 1)).toISOString(),
    value: start * Math.pow(1 + growth, index),
  }));
}

const market = {
  assets: {
    dollar: { price: 500000 },
    gold: { price: 10000000 },
    silver: { price: 200000 },
  },
  funds: { fixedIncome: { effectiveAnnualReturn: 25 } },
  history: { dollar: series(400000, 0.02), gold: series(8000000, 0.025), silver: series(150000, 0.03) },
};

test("recommendation stays normalized and defensive for a conservative profile", () => {
  const result = recommendAllocation({ age: 45, horizonYears: 5, goal: "preservation", riskTolerance: "conservative", incomeStability: "mixed", emergencyFund: "partial" });
  assert.equal(Math.round(Object.values(result.weights).reduce((sum, value) => sum + value, 0)), 100);
  assert.ok(result.weights.fixed >= 60);
  assert.ok(result.weights.silver >= 1);
});

test("deterministic simulation accounts for contribution growth and inflation", () => {
  const result = simulatePlan({ initialInvestment: 1000, monthlyContribution: 100, contributionGrowth: 0.1, inflationRate: 0.2, horizonYears: 2, allocation: { fixed: 100 }, annualReturns: { fixed: { annualReturn: 0 } }, rebalance: true });
  assert.ok(result.totalInvested > 1000 + 24 * 100);
  assert.equal(result.finalValue, result.totalInvested);
  assert.ok(result.finalRealValue < result.finalValue);
});

test("new contributions close allocation gaps without selling", () => {
  const plan = contributionRebalance({ fixed: 900, gold: 100, currency: 0, silver: 0 }, { fixed: 50, gold: 30, currency: 15, silver: 5 }, 100);
  assert.equal(Math.round(Object.values(plan.amounts).reduce((sum, value) => sum + value, 0)), 100);
  assert.ok(plan.amounts.gold > plan.amounts.fixed);
  assert.ok(plan.amounts.currency > 0);
  assert.ok(plan.amounts.silver > 0);
});

test("historical backtest returns requested risk metrics", () => {
  const result = backtestHistorical({ market, allocation: { fixed: 60, gold: 20, currency: 15, silver: 5 }, initialInvestment: 1000, monthlyContribution: 100, contributionGrowth: 0, inflationRate: 0.2, horizonYears: 2, rebalance: true });
  assert.equal(result.available, true);
  assert.ok(result.best && result.worst);
  assert.ok(Number.isFinite(result.median.cagr));
  assert.ok(Number.isFinite(result.median.maxDrawdown));
  assert.equal(Object.keys(result.coverage).length, ASSET_KEYS.length);
});

test("Monte Carlo returns ordered percentile outputs", () => {
  let state = 17;
  const random = () => { state = (state * 9301 + 49297) % 233280; return state / 233280; };
  const result = runMonteCarlo({ market, allocation: { fixed: 60, gold: 20, currency: 15, silver: 5 }, initialInvestment: 0, monthlyContribution: 100, horizonYears: 3, inflationRate: 0.2, paths: 1000, random });
  assert.equal(result.paths, 1000);
  assert.ok(result.nominal.p10 <= result.nominal.p50);
  assert.ok(result.nominal.p50 <= result.nominal.p90);
  assert.ok(result.real.p10 <= result.real.p90);
});

test("history export round-trips sanitized records", () => {
  const record = { createdAt: "2026-01-01T00:00:00.000Z", total: 1000, contributionRate: 20, weights: { fixed: 70, gold: 20, currency: 8, silver: 2 }, salary: 5000, marketSnapshot: { capturedAt: "2026-01-01T00:00:00.000Z", assets: { dollar: { price: 500000 } }, funds: { fixedIncome: { effectiveAnnualReturn: 25 } } } };
  const exported = createHistoryExport([record]);
  const parsed = parseHistoryExport(JSON.parse(JSON.stringify(exported)));
  assert.equal(exported.schema, "invest-consult-history");
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].weights.fixed + parsed.records[0].weights.gold + parsed.records[0].weights.currency + parsed.records[0].weights.silver, 100);
});

test("legacy rate records are accepted and invalid records are skipped", () => {
  const legacy = { createdAt: "2026-02-01", total: 2000, rate: 15, weights: { fixed: 80, gold: 15, currency: 5, silver: 0 } };
  assert.equal(sanitizeHistoryEntry(legacy).contributionRate, 15);
  const parsed = parseHistoryExport({ schema: "invest-consult-history", version: 1, history: [legacy, { total: -2 }] });
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.skipped, 1);
});

test("history merge keeps current duplicate timestamps and applies the limit", () => {
  const first = { createdAt: "2026-03-01", total: 1, contributionRate: 1, weights: { fixed: 100 } };
  const duplicate = { createdAt: "2026-03-01", total: 999, contributionRate: 99, weights: { gold: 100 } };
  const second = { createdAt: "2026-03-02", total: 2, contributionRate: 2, weights: { gold: 100 } };
  const merged = mergeHistory([first], [duplicate, second], 2);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].total, 1);
});

test("portfolio ledger replays cash flows and values holdings from market data", () => {
  const portfolioMarket = {
    updatedAt: "2026-01-01T00:00:00.000Z",
    assets: { gold: { price: 120 }, dollar: { price: 500 }, silver: { price: 10 } },
    history: { gold: [{ date: "2025-01-01", value: 100 }] },
  };
  let portfolio = createEmptyPortfolio("2025-01-01T00:00:00.000Z");
  const transactions = [
    createTransaction({ type: "OPENING", assetId: "fixed", quantity: 100, date: "2025-01-01" }, portfolioMarket, "2025-01-01T00:00:00.000Z"),
    createTransaction({ type: "BUY", assetId: "fixed", quantity: 50, unitPrice: 1, date: "2025-02-01" }, portfolioMarket, "2025-02-01T00:00:00.000Z"),
    createTransaction({ type: "SELL", assetId: "fixed", quantity: 20, unitPrice: 1, date: "2025-03-01" }, portfolioMarket, "2025-03-01T00:00:00.000Z"),
    createTransaction({ type: "TRANSFER", assetId: "fixed", quantity: 10, targetAssetId: "cash", targetQuantity: 10, date: "2025-04-01" }, portfolioMarket, "2025-04-01T00:00:00.000Z"),
    createTransaction({ type: "DEPOSIT", assetId: "cash", amount: 10, date: "2025-05-01" }, portfolioMarket, "2025-05-01T00:00:00.000Z"),
    createTransaction({ type: "DIVIDEND", assetId: "fixed", amount: 5, date: "2025-06-01" }, portfolioMarket, "2025-06-01T00:00:00.000Z"),
  ];
  portfolio = appendTransactions(portfolio, transactions, { action: "test-ledger", affectsHistory: true }).portfolio;
  const result = calculatePortfolio(portfolio, portfolioMarket, "2026-01-01T00:00:00.000Z");
  assert.equal(result.holdings.fixed, 120);
  assert.equal(result.holdings.cash, 25);
  assert.equal(result.currentValue, 145);
  assert.equal(result.netInvested, 140);
  assert.equal(result.profitLoss, 5);
});

test("portfolio versions preserve the prior ledger when tracking restarts", () => {
  const portfolioMarket = { assets: { gold: { price: 100 } }, history: { gold: [{ date: "2025-01-01", value: 100 }] } };
  let portfolio = createEmptyPortfolio("2025-01-01T00:00:00.000Z");
  const first = createTransaction({ type: "OPENING", assetId: "gold", quantity: 2, date: "2025-01-01" }, portfolioMarket, "2025-01-01T00:00:00.000Z");
  portfolio = appendTransactions(portfolio, [first], { action: "opening", affectsHistory: true }).portfolio;
  const second = createTransaction({ type: "OPENING", assetId: "fixed", quantity: 300, date: "2026-01-01" }, portfolioMarket, "2026-01-01T00:00:00.000Z");
  const versioned = createPortfolioVersion(portfolio, [second], "Restart", "2026-01-01T00:00:00.000Z");
  assert.equal(versioned.validation.valid, true);
  assert.equal(versioned.portfolio.versions.length, 2);
  assert.equal(versioned.portfolio.versions[0].transactions.length, 1);
  assert.equal(calculatePortfolio(versioned.portfolio, portfolioMarket, "2026-01-01T00:00:00.000Z").holdings.gold, 0);
  assert.equal(calculatePortfolio(versioned.portfolio, portfolioMarket, "2026-01-01T00:00:00.000Z").holdings.fixed, 300);
});

test("portfolio history leaves missing market periods blank", () => {
  const portfolioMarket = {
    updatedAt: "2025-08-01T00:00:00.000Z",
    assets: { gold: { price: 180 } },
    history: { gold: [{ date: "2025-07-01", value: 170 }] },
  };
  let portfolio = createEmptyPortfolio("2025-01-01T00:00:00.000Z");
  const opening = createTransaction({ type: "OPENING", assetId: "gold", quantity: 1, unitPrice: 100, date: "2025-01-01" }, portfolioMarket, "2025-01-01T00:00:00.000Z");
  portfolio = appendTransactions(portfolio, [opening]).portfolio;
  const series = portfolioSeries(portfolio, portfolioMarket, "2025-01-01", "2025-08-01");
  assert.equal(series[0].value, null);
  assert.ok(series.some((point) => point.value === 170));
});

test("history export round-trips the portfolio ledger", () => {
  const portfolioMarket = { assets: { gold: { price: 100 } }, history: { gold: [{ date: "2026-01-01", value: 100 }] } };
  let portfolio = createEmptyPortfolio("2026-01-01T00:00:00.000Z");
  const opening = createTransaction({ type: "OPENING", assetId: "gold", quantity: 1, date: "2026-01-01" }, portfolioMarket, "2026-01-01T00:00:00.000Z");
  portfolio = appendTransactions(portfolio, [opening]).portfolio;
  const exported = createHistoryExport([], portfolio);
  const parsed = parseHistoryExport(JSON.parse(JSON.stringify(exported)));
  assert.equal(parsed.portfolio.schema, "invest-consult-portfolio");
  assert.equal(parsed.portfolio.versions[0].transactions.length, 1);
});
