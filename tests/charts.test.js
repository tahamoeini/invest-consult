import test from "node:test";
import assert from "node:assert/strict";
import { donutChartMarkup, lineChartMarkup, lineSegments, normalizeSeriesIndex } from "../src/ui/charts.js";

test("line chart data keeps missing market periods as visible gaps", () => {
  const segments = lineSegments([{ value: 10 }, { value: null }, { value: 20 }, { value: 30 }]);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments[0].map((point) => point.value), [10]);
  assert.deepEqual(segments[1].map((point) => point.value), [20, 30]);
});

test("normalized comparison series uses the first observed value as index 100", () => {
  assert.deepEqual(normalizeSeriesIndex([{ value: 50 }, { value: 75 }, { value: null }]).map((point) => point.value), [100, 150, null]);
});

test("chart markup has explicit empty states and accessible SVG output", () => {
  assert.match(lineChartMarkup({ series: [{ name: "سبد", points: [{ value: 10 }] }] }), /داده کافی/);
  const markup = lineChartMarkup({ ariaLabel: "سبد", series: [{ name: "سبد", points: [{ value: 10, label: "اول" }, { value: 12, label: "دوم" }] }] });
  assert.match(markup, /role="img"/);
  assert.match(markup, /chart-line/);
  assert.match(markup, /chart-axis-label/);
  assert.match(markup, /<title>سبد<\/title>/);
  assert.match(lineChartMarkup({ series: [{ points: [{ value: 10 }] }, { points: [{ value: 12 }] }] }), /داده کافی/);
  assert.match(donutChartMarkup({ segments: [{ name: "طلا", value: 100, color: "#c18a2c" }] }), /donut-chart/);
  assert.match(donutChartMarkup({ segments: [] }), /هنوز دارایی/);
});
