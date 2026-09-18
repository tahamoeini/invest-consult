import test from "node:test";
import assert from "node:assert/strict";
import { createAppStore } from "../src/ui/state.js";

const values = new Map();
globalThis.localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};

test("application state preserves shared data while navigation remains dashboard-first", () => {
  values.clear();
  values.set("invest-consult-ui-preferences-v1", JSON.stringify({ activeView: "portfolio", sidebarCollapsed: true }));
  const store = createAppStore();
  assert.equal(store.getState().activeView, "dashboard");
  assert.equal(store.getState().sidebarCollapsed, true);

  store.setState({ activeView: "portfolio", monthlyInvestment: 2500000, market: { assets: {} } });
  assert.equal(store.getState().monthlyInvestment, 2500000);
  assert.deepEqual(store.getState().market, { assets: {} });

  const restored = createAppStore();
  assert.equal(restored.getState().activeView, "dashboard");
  assert.equal(restored.getState().sidebarCollapsed, true);
});
