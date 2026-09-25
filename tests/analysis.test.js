import test from "node:test";
import assert from "node:assert/strict";
import { estimateReturnModel, simulatePlan } from "../src/engine.js";
import { runAnalysisTask } from "../src/analysis.js";

function historySeries(start = 100, growth = 0.02, count = 36) {
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(Date.UTC(2020 + Math.floor(index / 12), index % 12, 1)).toISOString(),
    value: start * Math.pow(1 + growth, index),
  }));
}

test("analysis task matches the pure simulation engine and returns walk-forward diagnostics", () => {
  const market = { history: { gold: historySeries() } };
  const options = {
    market,
    allocation: { fixed: 60, gold: 40 },
    initialInvestment: 1000,
    monthlyContribution: 100,
    contributionGrowth: 0,
    inflationRate: 0.3,
    horizonYears: 1,
    paths: 1000,
    rebalance: true,
  };
  const taskResult = runAnalysisTask({ type: "plan-analysis", options });
  const model = estimateReturnModel(market);
  const expected = simulatePlan({ ...options, annualReturns: model.model });
  assert.equal(taskResult.simulation.finalValue, expected.finalValue);
  assert.ok(["gaussian", "ewma", "block-bootstrap"].includes(taskResult.monteCarlo.method));
  assert.equal(taskResult.monteCarlo.paths, 1000);
  assert.ok(taskResult.validation.diagnostics.gold.observations >= 3);
});

test("instrument and sleeve catalogs keep decision categories separate", async () => {
  const {
    INSTRUMENT_REGISTRY,
    OPTIONAL_RECOMMENDATION_ASSETS,
    PLAN_ASSET_KEYS,
    PLANNING_ASSET_TO_SLEEVE,
    SIMULATION_ASSET_KEYS,
    SLEEVE_REGISTRY,
  } = await import("../src/market/catalog.js");
  assert.equal(INSTRUMENT_REGISTRY.bitcoin.sleeveId, "crypto");
  assert.equal(INSTRUMENT_REGISTRY.bourseIndex.tradable, false);
  assert.equal(PLANNING_ASSET_TO_SLEEVE.silver, "commodities");
  assert.equal(SLEEVE_REGISTRY.globalEquity.recommendationEligible, false);
  assert.equal(SLEEVE_REGISTRY.crypto.recommendationEligible, true);
  assert.equal(INSTRUMENT_REGISTRY.tether.simulationOnly, true);
  assert.equal(INSTRUMENT_REGISTRY.bitcoin.recommendationOptional, true);
  assert.deepEqual(OPTIONAL_RECOMMENDATION_ASSETS, ["bitcoin", "ethereum", "platinum", "palladium", "copper"]);
  assert.deepEqual(PLAN_ASSET_KEYS.slice(0, 4), ["fixed", "gold", "currency", "silver"]);
  assert.ok(
    ["bitcoin", "ethereum", "copper", "platinum", "palladium"].every((assetId) =>
      SIMULATION_ASSET_KEYS.includes(assetId),
    ),
  );
  assert.ok(SIMULATION_ASSET_KEYS.includes("tether"));
  assert.equal(OPTIONAL_RECOMMENDATION_ASSETS.includes("tether"), false);
  assert.equal(OPTIONAL_RECOMMENDATION_ASSETS.includes("bourseIndex"), false);
});
