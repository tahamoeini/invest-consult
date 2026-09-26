import test from "node:test";
import assert from "node:assert/strict";
import {
  deferPlatformProviderRequest,
  readPlatformProviderCache,
  reservePlatformProviderRequest,
  writePlatformProviderCache,
} from "../functions/api/_security.js";
import { createSecureApiContext } from "./helpers/api-context.js";

test("shared provider cache preserves payload and millisecond timestamps", async () => {
  const { env } = await createSecureApiContext("https://app.test/api/market");
  const fetchedAt = Date.now();
  const payload = { quotes: [{ asset: "bitcoin", price: 42 }] };
  assert.equal(await writePlatformProviderCache(env, "test-provider", payload, fetchedAt), true);
  assert.deepEqual(await readPlatformProviderCache(env, "test-provider"), {
    quotes: payload,
    fetchedAt: Math.floor(fetchedAt / 1000) * 1000,
  });
});

test("provider request reservation enforces a 60-second minimum and monthly cap", async () => {
  const { env } = await createSecureApiContext("https://app.test/api/market");
  const originalNow = Date.now;
  const base = originalNow();
  try {
    Date.now = () => base;
    assert.equal(
      await reservePlatformProviderRequest(env, "interval-provider", { monthlyLimit: 5, minimumIntervalSeconds: 60 }),
      true,
    );
    assert.equal(
      await reservePlatformProviderRequest(env, "interval-provider", { monthlyLimit: 5, minimumIntervalSeconds: 60 }),
      false,
    );
    Date.now = () => base + 59_000;
    assert.equal(
      await reservePlatformProviderRequest(env, "interval-provider", { monthlyLimit: 5, minimumIntervalSeconds: 60 }),
      false,
    );
    Date.now = () => base + 60_000;
    assert.equal(
      await reservePlatformProviderRequest(env, "interval-provider", { monthlyLimit: 5, minimumIntervalSeconds: 60 }),
      true,
    );
    assert.equal(
      await reservePlatformProviderRequest(env, "monthly-provider", { monthlyLimit: 1, minimumIntervalSeconds: 60 }),
      true,
    );
    Date.now = () => base + 120_000;
    assert.equal(
      await reservePlatformProviderRequest(env, "monthly-provider", { monthlyLimit: 1, minimumIntervalSeconds: 60 }),
      false,
    );
  } finally {
    Date.now = originalNow;
  }
});

test("Retry-After extends a provider cooldown", async () => {
  const { env } = await createSecureApiContext("https://app.test/api/market");
  const originalNow = Date.now;
  const base = originalNow();
  try {
    Date.now = () => base;
    assert.equal(
      await reservePlatformProviderRequest(env, "retry-provider", { monthlyLimit: 5, minimumIntervalSeconds: 60 }),
      true,
    );
    assert.equal(await deferPlatformProviderRequest(env, "retry-provider", 300), true);
    Date.now = () => base + 60_000;
    assert.equal(
      await reservePlatformProviderRequest(env, "retry-provider", { monthlyLimit: 5, minimumIntervalSeconds: 60 }),
      false,
    );
    Date.now = () => base + 300_000;
    assert.equal(
      await reservePlatformProviderRequest(env, "retry-provider", { monthlyLimit: 5, minimumIntervalSeconds: 60 }),
      true,
    );
  } finally {
    Date.now = originalNow;
  }
});

test("batched provider credits are charged by the number of requested assets", async () => {
  const { env } = await createSecureApiContext("https://app.test/api/market");
  const budget = { monthlyLimit: 6, minimumIntervalSeconds: 60, quotaUnits: 3 };
  const originalNow = Date.now;
  const base = originalNow();
  try {
    Date.now = () => base;
    assert.equal(await reservePlatformProviderRequest(env, "credit-provider", budget), true);
    assert.equal(await reservePlatformProviderRequest(env, "credit-provider", budget), false);
    const oneCredit = { ...budget, quotaUnits: 1 };
    Date.now = () => base + 60_000;
    assert.equal(await reservePlatformProviderRequest(env, "credit-provider", oneCredit), true);
    Date.now = () => base + 120_000;
    assert.equal(await reservePlatformProviderRequest(env, "credit-provider", budget), false);
  } finally {
    Date.now = originalNow;
  }
});
