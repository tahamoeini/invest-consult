import test from "node:test";
import assert from "node:assert/strict";
import { aggregate, extractTgjuChartData, normalizeMetalHistory, normalizeTgjuHistory } from "../functions/api/market.js";

test("metal history converts troy-ounce closes to grams", () => {
  const [gold] = normalizeMetalHistory([{ date: "2026-09-18", close: 4379.74 }]);
  assert.ok(Math.abs(gold.value - 140.81) < 0.01);
});

test("metal history accepts object-shaped source points", () => {
  const [silver] = normalizeMetalHistory({ "2026-09-18": 66.921 });
  assert.ok(Math.abs(silver.value - 2.1516) < 0.001);
});

test("TGJU chart history parses balanced arrays and converts rial to toman", () => {
  const html = `$("#ChartBlock-3").msHighcharts({ chartData: [[1700000000000, 233630000],[1700086400000, 234000000]], tooltipTitle: 'قیمت', chartType: "area" });`;
  assert.deepEqual(extractTgjuChartData(html), [[1700000000000, 233630000], [1700086400000, 234000000]]);
  assert.deepEqual(normalizeTgjuHistory(extractTgjuChartData(html)), [
    { date: 1700000000000, value: 23363000 },
    { date: 1700086400000, value: 23400000 },
  ]);
});

test("TGJU history does not use a synthetic FX conversion", () => {
  const [gold] = normalizeTgjuHistory([[1700000000000, 233630000]]);
  assert.equal(gold.value, 23363000);
});

test("market aggregation keeps missing change data unavailable", () => {
  const result = aggregate("dollar", [
    { asset: "dollar", price: 100, source: "A", changePct: null, sourceTime: "2026-01-01T00:00:00.000Z" },
    { asset: "dollar", price: 110, source: "B", changePct: undefined, sourceTime: "2026-01-02T00:00:00.000Z" },
  ]);
  assert.equal(result.price, 105);
  assert.equal(result.changePct, null);
  assert.equal(result.asOf, "2026-01-02T00:00:00.000Z");
});
