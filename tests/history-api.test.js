import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, parseHistoryRequest } from "../functions/api/history.js";

function tgjuPage(points) {
  return '$("#ChartBlock-3").msHighcharts({ chartData: ' + JSON.stringify(points) + ', chartType: "line" });';
}

function withFetch(handler, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      globalThis.fetch = originalFetch;
    });
}

test("history requests accept only known assets and ranges", () => {
  assert.deepEqual(parseHistoryRequest("https://app.test/api/history?assets=gold,unknown,silver&range=6m"), {
    assets: ["gold", "silver"],
    range: "6m",
  });
  assert.equal(
    parseHistoryRequest("https://app.test/api/history?assets=unknown&range=all").error,
    "no-supported-assets",
  );
  assert.equal(parseHistoryRequest("https://app.test/api/history?assets=gold&range=forever").error, "invalid-range");
  assert.deepEqual(parseHistoryRequest("https://app.test/api/history").assets, ["dollar", "gold", "silver"]);
});

test("history endpoint returns source-labelled Toman observations using dated FX", async () => {
  const now = Date.now();
  const dates = [now - 2 * 86400000, now - 86400000, now];
  const dollarRows = dates.map((date, index) => [date, 2300000 + index * 10000]);
  const cryptoRows = dates.map((date, index) => [date, 100 + index * 10]);
  const response = await withFetch(
    async (input, options = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (url.hostname === "www.tgju.org") return new Response(tgjuPage(dollarRows), { status: 200 });
      if (url.hostname === "api.coingecko.com") {
        assert.equal(options.headers["x-cg-demo-api-key"], "demo-key");
        return new Response(JSON.stringify({ prices: cryptoRows }), { status: 200 });
      }
      throw new Error("unexpected-provider " + url.href);
    },
    async () =>
      onRequestGet({
        request: new Request("https://app.test/api/history?assets=bitcoin,dollar&range=all"),
        env: { COINGECKO_DEMO_API_KEY: "demo-key" },
      }),
  );
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.assets.bitcoin.coverage.status, "available");
  assert.equal(data.assets.bitcoin.coverage.source, "CoinGecko");
  assert.equal(data.assets.bitcoin.points[0].source, "CoinGecko");
  assert.equal(data.assets.bitcoin.points[0].currency, "TOMAN");
  assert.equal(data.assets.bitcoin.points[0].value, 23000000);
  assert.equal(data.assets.bitcoin.points[0].conversion.dollarSource, "TGJU");
  assert.equal(data.assets.dollar.points[0].value, 230000);
});

test("crypto history stays unavailable without the optional Demo key", async () => {
  const requestedUrls = [];
  const response = await withFetch(
    async (input) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      requestedUrls.push(url.href);
      if (url.hostname === "www.tgju.org") return new Response(tgjuPage([[Date.now(), 2300000]]), { status: 200 });
      throw new Error("unexpected-provider " + url.href);
    },
    async () =>
      onRequestGet({
        request: new Request("https://app.test/api/history?assets=bitcoin&range=1y"),
        env: {},
      }),
  );
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.assets.bitcoin.coverage.status, "unavailable");
  assert.equal(data.assets.bitcoin.coverage.reason, "coingecko-demo-key-missing");
  assert.equal(
    requestedUrls.some((url) => url.includes("api.coingecko.com")),
    false,
  );
});

test("a failed local history provider returns partial results and labels the unavailable asset", async () => {
  const now = Date.now();
  const response = await withFetch(
    async (input) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (url.hostname === "www.tgju.org" && url.pathname.endsWith("/price_dollar_rl")) {
        return new Response(
          tgjuPage([
            [now - 86400000, 2300000],
            [now, 2320000],
          ]),
          { status: 200 },
        );
      }
      if (url.hostname === "www.tgju.org" && url.pathname.endsWith("/geram18"))
        return new Response("provider unavailable", { status: 503 });
      if (url.hostname === "www.chartgoldprice.com") {
        return new Response(
          JSON.stringify({
            history: {
              gold: [
                [now - 86400000, 80],
                [now, 82],
              ],
            },
          }),
          { status: 200 },
        );
      }
      throw new Error("unexpected-provider " + url.href);
    },
    async () =>
      onRequestGet({
        request: new Request("https://app.test/api/history?assets=gold,dollar&range=all"),
      }),
  );
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.assets.gold.coverage.status, "available");
  assert.equal(data.assets.gold.coverage.source, "ChartGoldPrice");
  assert.equal(data.assets.dollar.coverage.status, "available");
});

test("unsupported range and empty allowlist return a clear 400 response", async () => {
  const response = await onRequestGet({ request: new Request("https://app.test/api/history?assets=gold&range=bad") });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid-range" });
});
