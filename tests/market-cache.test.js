import test from "node:test";
import assert from "node:assert/strict";
import { marketCacheAge } from "../src/market/cache.js";

test("a missing or malformed cached market is safely treated as stale", () => {
  assert.equal(marketCacheAge(null, 1_000), Infinity);
  assert.equal(marketCacheAge(undefined, 1_000), Infinity);
  assert.equal(marketCacheAge([], 1_000), Infinity);
  assert.equal(marketCacheAge({ updatedAt: null }, 1_000), Infinity);
  assert.equal(marketCacheAge({ updatedAt: "not-a-date" }, 1_000), Infinity);
});

test("a valid cache timestamp returns its age without dereferencing missing data", () => {
  assert.equal(
    marketCacheAge({ updatedAt: "2026-09-25T11:25:00.000Z" }, Date.parse("2026-09-25T11:26:00.000Z")),
    60_000,
  );
});
