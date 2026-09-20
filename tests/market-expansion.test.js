import test from "node:test";
import assert from "node:assert/strict";
import { aggregate } from "../functions/api/market.js";
import {
  appendTransactions,
  calculatePortfolio,
  createEmptyPortfolio,
  createTransaction,
} from "../src/portfolio.js";

test("expanded market aggregation preserves asset units and independent quotes", () => {
  const result = aggregate("bitcoin", [
    { asset: "bitcoin", price: 2000000000, source: "CoinGecko", unit: "coin" },
    { asset: "bitcoin", price: 2100000000, source: "Binance", unit: "coin" },
  ]);
  assert.equal(result.price, 2050000000);
  assert.equal(result.unit, "coin");
  assert.equal(result.sourceCount, 2);
});

test("market-priced crypto can be added to the immutable portfolio ledger", () => {
  const now = "2026-09-20T00:00:00.000Z";
  const portfolio = createEmptyPortfolio(now);
  const market = {
    updatedAt: now,
    assets: { bitcoin: { price: 2000000000 } },
    history: {},
  };
  const transaction = createTransaction({
    type: "OPENING",
    assetId: "bitcoin",
    quantity: 0.1,
    date: now,
    source: "test",
  }, market, now, portfolio);
  assert.ok(transaction);
  assert.equal(transaction.unitPrice, 2000000000);
  const appended = appendTransactions(portfolio, [transaction], { action: "test-opening" });
  assert.equal(appended.validation.valid, true);
  const result = calculatePortfolio(appended.portfolio, market, now);
  assert.equal(result.holdings.bitcoin, 0.1);
  assert.equal(result.currentValue, 200000000);
  assert.equal(result.missingPrices.length, 0);
});

test("portfolio refuses a market asset entry when no valid price exists", () => {
  const now = "2026-09-20T00:00:00.000Z";
  const portfolio = createEmptyPortfolio(now);
  const transaction = createTransaction({
    type: "OPENING",
    assetId: "platinum",
    quantity: 10,
    date: now,
  }, { updatedAt: now, assets: {}, history: {} }, now, portfolio);
  assert.equal(transaction, null);
});
