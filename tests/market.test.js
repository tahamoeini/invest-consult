import test from "node:test";
import assert from "node:assert/strict";
import { aggregate, extractTgjuChartData, normalizeMetalHistory, normalizeTgjuHistory, onRequestGet, parseRequestedAssets } from "../functions/api/market.js";

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

test("market aggregation refuses to invent a midpoint when two sources disagree", () => {
  const result = aggregate("dollar", [
    { asset: "dollar", price: 100, source: "A", changePct: null, sourceTime: "2026-01-01T00:00:00.000Z" },
    { asset: "dollar", price: 110, source: "B", changePct: undefined, sourceTime: "2026-01-02T00:00:00.000Z" },
  ]);
  assert.equal(result.price, null);
  assert.equal(result.status, "conflicted");
  assert.equal(result.sourceCount, 0);
  assert.equal(result.changePct, null);
  assert.equal(result.asOf, "2026-01-02T00:00:00.000Z");
});

test("a single quote remains visible with degraded confidence", () => {
  const result = aggregate("dollar", [{ asset: "dollar", price: 100, source: "A" }]);
  assert.equal(result.price, 100);
  assert.equal(result.status, "degraded");
  assert.equal(result.confidence, "low");
});

test("selected market assets are allow-listed", () => {
  const selected = parseRequestedAssets("https://example.test/api/market?assets=bitcoin,unknown,gold");
  assert.deepEqual([...selected].sort(), ["bitcoin", "gold"]);
  assert.equal(parseRequestedAssets("https://example.test/api/market"), null);
});

test("selected crypto requests fetch only that instrument and preserve partial data when a provider fails", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    requestedUrls.push(url);
    if (url.hostname === "www.tgju.org") {
      return new Response('<td data-col="info.last_trade.PDrCotVal">500000</td>', { status: 200 });
    }
    if (url.hostname === "www.bonbast.com" && options.method !== "POST") {
      return new Response(`$.post('/json', {param: "token"});`, { status: 200, headers: { "set-cookie": "session=one" } });
    }
    if (url.hostname === "www.bonbast.com") {
      return new Response(JSON.stringify({ usd1: "50000", gol18: "40000000" }), { status: 200 });
    }
    if (url.hostname === "api.coingecko.com") {
      return new Response(JSON.stringify({ bitcoin: { usd: 60000, usd_24h_change: 1 } }), { status: 200 });
    }
    if (url.hostname === "api.binance.com") {
      return new Response("unavailable", { status: 503 });
    }
    throw new Error(`Unexpected request: ${url.href}`);
  };
  try {
    const response = await onRequestGet({ request: new Request("https://app.test/api/market?assets=bitcoin") });
    const data = await response.json();
    assert.deepEqual(Object.keys(data.assets), ["bitcoin"]);
    assert.equal(data.assets.bitcoin.price, 3000000000);
    assert.equal(data.assets.bitcoin.quoteType, "derived");
    assert.deepEqual(data.assets.bitcoin.derivedFrom, ["bitcoin/USD", "USD/TOMAN"]);
    assert.equal(data.assets.bitcoin.status, "degraded");
    assert.equal(data.assets.bitcoin.sourceCount, 1);
    assert.equal(data.assets.bitcoin.sleeveId, "crypto");
    assert.equal(data.assets.bitcoin.dependencies[0].instrumentId, "dollar");
    assert.equal(data.assets.bitcoin.dependencies[0].status, "healthy");
    assert.equal(data.assets.bitcoin.observedAt, null);
    assert.ok(data.assets.bitcoin.retrievedAt);
    assert.ok(requestedUrls.some((url) => url.hostname === "www.tgju.org" && url.pathname.endsWith("price_dollar_rl")));
    const cryptoUrl = requestedUrls.find((url) => url.hostname === "api.coingecko.com");
    assert.equal(cryptoUrl.searchParams.get("ids"), "bitcoin");
    const exchangeUrl = requestedUrls.find((url) => url.hostname === "api.binance.com");
    assert.deepEqual(JSON.parse(exchangeUrl.searchParams.get("symbols")), ["BTCUSDT"]);
    assert.equal(data.diagnostics.providers.binance.status, "rejected");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("USDT exchange pairs are not converted as if USDT were USD cash", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "www.tgju.org") return new Response('<td data-col="info.last_trade.PDrCotVal">500000</td>', { status: 200 });
    if (url.hostname === "www.bonbast.com" && options.method !== "POST") return new Response(`$.post('/json', {param: "token"});`, { status: 200 });
    if (url.hostname === "www.bonbast.com") return new Response(JSON.stringify({ usd1: "50000" }), { status: 200 });
    if (url.hostname === "api.coingecko.com") return new Response(JSON.stringify({ bitcoin: { usd: 60000 } }), { status: 200 });
    if (url.hostname === "api.binance.com") return new Response(JSON.stringify([{ symbol: "BTCUSDT", lastPrice: "65000", priceChangePercent: "2" }]), { status: 200 });
    throw new Error(`Unexpected request: ${url.href}`);
  };
  try {
    const response = await onRequestGet({ request: new Request("https://app.test/api/market?assets=bitcoin") });
    const data = await response.json();
    assert.equal(data.assets.bitcoin.price, 3000000000);
    assert.equal(data.assets.bitcoin.sourceCount, 1);
    assert.deepEqual(data.assets.bitcoin.sources, ["CoinGecko"]);
    assert.equal(data.diagnostics.providers.binance.status, "fulfilled");
    assert.equal(data.diagnostics.assets.bitcoin.attempted, 2);
    assert.equal(data.diagnostics.assets.bitcoin.excludedForCurrency, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TSETMC retrieval time is not misreported as the market observation time", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ indexValue: 2000000, previousValue: 1990000 }), { status: 200 });
  try {
    const response = await onRequestGet({ request: new Request("https://app.test/api/market?assets=bourseIndex") });
    const data = await response.json();
    assert.equal(data.assets.bourseIndex.observedAt, null);
    assert.ok(data.assets.bourseIndex.retrievedAt);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gold auxiliary quotes are fetched only after primary and fallback sources conflict", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    requestedUrls.push(url);
    if (url.hostname === "www.tgju.org") {
      const value = url.pathname.endsWith("geram18") ? "400000000" : "500000";
      return new Response(`<td data-col="info.last_trade.PDrCotVal">${value}</td>`, { status: 200 });
    }
    if (url.hostname === "www.bonbast.com" && options.method !== "POST") {
      return new Response(`$.post('/json', {param: "token"});`, { status: 200, headers: { "set-cookie": "session=one" } });
    }
    if (url.hostname === "www.bonbast.com") {
      return new Response(JSON.stringify({ usd1: "50000", gol18: "41000000" }), { status: 200 });
    }
    if (url.hostname === "raw.githubusercontent.com" && url.pathname.endsWith("fiat.json")) {
      return new Response(JSON.stringify({ usd: { value: "50000", date: 1770000000 } }), { status: 200 });
    }
    if (url.hostname === "raw.githubusercontent.com") {
      return new Response(JSON.stringify({ "18ayar": { value: "40500000", date: 1770000000 } }), { status: 200 });
    }
    if (url.hostname === "www.chartgoldprice.com") {
      return new Response(JSON.stringify({ prices: { gold: { gram: 1080 }, silver: { gram: 1 } }, history: {} }), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url.href}`);
  };
  try {
    const response = await onRequestGet({ request: new Request("https://app.test/api/market?assets=gold") });
    const data = await response.json();
    assert.ok(requestedUrls.some((url) => url.hostname === "www.chartgoldprice.com"));
    assert.equal(data.diagnostics.providers.auxiliary.status, "fulfilled");
    assert.equal(data.diagnostics.providers.auxiliary.quoteCount, 1);
    assert.equal(data.assets.gold.status, "conflicted");
    assert.equal(data.assets.gold.price, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("primary, fallback, and auxiliary provider timeouts return within the interactive budget", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, { signal } = {}) => await new Promise((_resolve, reject) => {
    const abort = () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
  try {
    const startedAt = Date.now();
    const response = await onRequestGet({ request: new Request("https://app.test/api/market?assets=gold") });
    const data = await response.json();
    const elapsed = Date.now() - startedAt;
    assert.equal(data.assets.gold, undefined);
    assert.equal(data.diagnostics.providers.providerA.status, "rejected");
    assert.equal(data.diagnostics.providers.providerC.status, "rejected");
    assert.equal(data.diagnostics.providers.auxiliary.status, "rejected");
    assert.ok(elapsed < 3500);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
