import test from "node:test";
import assert from "node:assert/strict";
import { reconcileMarketWithRecentAcceptedQuote } from "../src/market/reconcile.js";

test("a recent accepted quote anchors a highly divergent pair and rescales dependent assets", () => {
  const priorTime = "2026-09-25T11:00:00.000Z";
  const currentTime = "2026-09-25T11:08:00.000Z";
  const market = {
    updatedAt: currentTime,
    assets: {
      dollar: {
        price: 7.5,
        status: "degraded",
        confidence: "low",
        consensusDisagreement: true,
        sourceCount: 2,
        sources: ["A", "B"],
        sourceValues: [
          { source: "A", price: 5, observedAt: "2026-09-25T11:05:00.000Z", accepted: true },
          { source: "B", price: 10, observedAt: currentTime, accepted: true },
        ],
      },
      bitcoin: {
        price: 75000,
        quoteType: "derived",
        derivedFrom: ["bitcoin/USD", "USD/TOMAN"],
        sourceValues: [{ source: "CoinGecko", price: 75000 }],
        dependencies: [{ instrumentId: "dollar", price: 7.5, status: "degraded", confidence: "low" }],
      },
    },
  };
  const previousMarket = {
    assets: { dollar: { price: 5, status: "healthy", observedAt: priorTime } },
  };

  const result = reconcileMarketWithRecentAcceptedQuote(market, previousMarket, Date.parse(currentTime));
  assert.equal(result.assets.dollar.price, 5);
  assert.deepEqual(result.assets.dollar.sources, ["A"]);
  assert.equal(result.assets.dollar.consensusMethod, "recent-anchor-median");
  assert.equal(result.assets.bitcoin.price, 50000);
  assert.equal(result.assets.bitcoin.dependencies[0].price, 5);
});

test("an old accepted quote does not override a fresh median estimate", () => {
  const market = {
    updatedAt: "2026-09-25T11:08:00.000Z",
    assets: {
      dollar: {
        price: 7.5,
        status: "degraded",
        confidence: "low",
        consensusDisagreement: true,
        sourceValues: [
          { source: "A", price: 5, observedAt: "2026-09-25T11:05:00.000Z" },
          { source: "B", price: 10, observedAt: "2026-09-25T11:08:00.000Z" },
        ],
      },
    },
  };
  const previousMarket = {
    assets: { dollar: { price: 5, status: "healthy", observedAt: "2026-09-25T05:00:00.000Z" } },
  };

  const result = reconcileMarketWithRecentAcceptedQuote(market, previousMarket, Date.parse(market.updatedAt));
  assert.equal(result.assets.dollar.price, 7.5);
  assert.equal(result.assets.dollar.consensusMethod, undefined);
});
