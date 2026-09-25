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

test("proposal previews wait for an explicit action before saving plan history", () => {
  assert.match(app, /renderPlan\(\{ scrollIntoView: false, validate: false \}\)/);
  assert.match(app, /function calculatePlan\(inputs\)/);
  assert.match(index, /id="save-plan-result"/);
  assert.match(app, /function savePlanPreview\(\)/);
  const preview = app.slice(app.indexOf("function renderPlan("), app.indexOf("function saveHistory("));
  assert.doesNotMatch(preview, /saveHistory\(/);
  assert.match(app, /addEventListener\("click", savePlanPreview\)/);
  assert.match(app, /Object\.keys\(result\.assets \|\| \{\}\)/);
});
