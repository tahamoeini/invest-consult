import test from "node:test";
import assert from "node:assert/strict";
import {
  convertUsdHistoryToToman,
  filterHistoryRange,
  normalizeObservedHistory,
  prepareComparableHistory,
} from "../src/market/history.js";

test("observed history normalizes dates, sorts observations, and keeps only one value per day", () => {
  const points = normalizeObservedHistory(
    [
      ["2026-01-02T12:00:00.000Z", 20],
      ["2026-01-01T12:00:00.000Z", 10],
      ["2026-01-02T18:00:00.000Z", 22],
      ["2026-01-03T00:00:00.000Z", null],
    ],
    "Test source",
  );
  assert.deepEqual(
    points.map((point) => point.value),
    [10, 22],
  );
  assert.deepEqual(
    points.map((point) => point.source),
    ["Test source", "Test source"],
  );
  assert.equal(points[1].date, "2026-01-02T18:00:00.000Z");
});

test("USD observations convert only when a dollar reading exists on the same date", () => {
  const converted = convertUsdHistoryToToman(
    [
      { date: "2026-01-01T01:00:00.000Z", value: 100, source: "CoinGecko" },
      { date: "2026-01-02T01:00:00.000Z", value: 110, source: "CoinGecko" },
      { date: "2026-01-03T01:00:00.000Z", value: 120, source: "CoinGecko" },
    ],
    [
      { date: "2026-01-01T00:00:00.000Z", value: 200000, source: "TGJU" },
      { date: "2026-01-03T00:00:00.000Z", value: 210000, source: "TGJU" },
    ],
  );
  assert.deepEqual(
    converted.points.map((point) => point.value),
    [20000000, 25200000],
  );
  assert.equal(converted.points[0].conversion.dollarSource, "TGJU");
  assert.equal(converted.missingFxCount, 1);
});

test("range filtering limits observations to the requested number of days", () => {
  const now = "2026-09-23T00:00:00.000Z";
  const points = [
    { date: "2026-08-01T00:00:00.000Z", value: 10 },
    { date: "2026-08-25T00:00:00.000Z", value: 11 },
    { date: "2026-09-23T00:00:00.000Z", value: 12 },
  ];
  assert.deepEqual(
    filterHistoryRange(points, "1m", now).map((point) => point.value),
    [11, 12],
  );
  assert.equal(filterHistoryRange(points, "all", now).length, 3);
  assert.deepEqual(filterHistoryRange(points, "bad", now), []);
});

test("comparison uses the shared observed range, actual dates, gaps, and per-series metrics", () => {
  const comparison = prepareComparableHistory(
    {
      gold: {
        name: "طلا",
        points: [
          { date: "2026-01-01T00:00:00.000Z", value: 100 },
          { date: "2026-01-02T00:00:00.000Z", value: 101 },
          { date: "2026-01-04T00:00:00.000Z", value: 121 },
        ],
      },
      dollar: {
        name: "ارز",
        points: [
          { date: "2026-01-02T00:00:00.000Z", value: 200 },
          { date: "2026-01-03T00:00:00.000Z", value: 190 },
          { date: "2026-01-04T00:00:00.000Z", value: 180 },
          { date: "2026-01-06T00:00:00.000Z", value: 170 },
        ],
      },
    },
    "all",
    "2026-01-10T00:00:00.000Z",
  );
  assert.equal(comparison.from, "2026-01-02T00:00:00.000Z");
  assert.equal(comparison.to, "2026-01-04T00:00:00.000Z");
  assert.deepEqual(
    comparison.series[0].points.map((point) => point.value),
    [100, null, (121 / 101) * 100],
  );
  assert.equal(comparison.metrics[0].periodReturn, 121 / 101 - 1);
  assert.equal(comparison.metrics[0].coverage, 2 / 3);
  assert.ok(Math.abs(comparison.metrics[1].periodReturn + 0.1) < 1e-12);
  assert.equal(comparison.series[1].points.length, 3);
});
