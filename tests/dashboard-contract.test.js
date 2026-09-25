import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("dashboard exposes the complete financial summary contract", () => {
  [
    "dashboard-current-value",
    "dashboard-invested",
    "dashboard-profit-loss",
    "dashboard-profit-loss-percent",
    "dashboard-monthly-contribution",
    "dashboard-tracking-duration",
    "dashboard-performance-chart",
    "dashboard-allocation-chart",
    "dashboard-action-allocation",
  ].forEach((id) => assert.match(index, new RegExp(`id="${id}"`)));
});

test("all internal views remain sibling sections", () => {
  const views = [...index.matchAll(/<section\b(?=[^>]*\bdata-app-view="([^"]+)")[^>]*>/g)].map((match) => match[1]);
  assert.deepEqual(views, ["dashboard", "plan", "simulation", "history", "portfolio", "assets", "settings"]);
});

test("plan editing uses a non-persisting live preview path", () => {
  assert.match(app, /renderPlan\(\{ saveHistoryRecord: false, scrollIntoView: false, validate: false \}\)/);
  assert.match(app, /function calculatePlan\(inputs\)/);
  assert.match(app, /Object\.keys\(result\.assets \|\| \{\}\)/);
});
