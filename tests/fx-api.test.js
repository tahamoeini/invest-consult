import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/fx.js";
import { createSecureApiContext } from "./helpers/api-context.js";

const DAY = 24 * 60 * 60 * 1000;

function makeFixtures() {
  const date = new Date().toISOString().slice(0, 10);
  const [year, month, day] = date.split("-");
  const cbrDate = day + "." + month + "." + year;
  return {
    frankfurter: JSON.stringify([{ date, base: "USD", quote: "CNY", rate: 7.12 }]),
    currencies:
      '<ValCurs Date="' +
      cbrDate +
      '" name="Foreign Currency Market"><Valute><CharCode>USD</CharCode><Nominal>1</Nominal><Value>81,25</Value></Valute></ValCurs>',
    metals:
      '<MetallRates><Record Date="' +
      cbrDate +
      '" Code="1"><Buy>12000,00</Buy><Sell>12100,00</Sell></Record><Record Date="' +
      cbrDate +
      '" Code="2"><Buy>140,00</Buy><Sell>145,00</Sell></Record></MetallRates>',
  };
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

function fixtureFetch(fixtures) {
  return async (input) => {
    const url = String(input);
    if (url.includes("api.frankfurter.dev")) return new Response(fixtures.frankfurter);
    if (url.includes("XML_daily_eng.asp")) return new Response(fixtures.currencies);
    if (url.includes("xml_metall.asp")) return new Response(fixtures.metals);
    throw new Error("Unexpected reference provider: " + url);
  };
}

async function request(url, context) {
  return onRequestGet(context || (await createSecureApiContext(url)));
}

test("FX endpoint returns dated, attributed cross rates without trusting caller market prices", async () => {
  const url =
    "https://app.test/api/fx?quotes=USD,RUB,CNY&include=metals&usdToman=100000&usdObservedAt=2026-09-25T12%3A00%3A00Z";
  const context = await createSecureApiContext(url);
  const result = await withFetch(fixtureFetch(makeFixtures()), async () => {
    const response = await request(url, context);
    assert.equal(response.status, 200);
    return await response.json();
  });
  assert.equal(result.base, "TOMAN");
  assert.equal(result.quotes.USD.rate, null);
  assert.equal(result.quotes.RUB.rate, null);
  assert.equal(result.quotes.CNY.rate, null);
  assert.equal(result.quotes.USD.observedAt, null);
  assert.equal(result.quotes.RUB.quotePerUsd, 81.25);
  assert.equal(result.quotes.CNY.quotePerUsd, 7.12);
  assert.equal(result.quotes.USD.status, "unavailable");
  for (const code of ["RUB", "CNY"]) {
    assert.equal(result.quotes[code].status, "available");
    assert.ok(result.quotes[code].source);
    assert.ok(result.quotes[code].retrievedAt);
    assert.ok(Array.isArray(result.quotes[code].derivedFrom));
  }
  assert.equal(result.preciousMetals.currency, "RUB");
  assert.equal(result.preciousMetals.unit, "gram");
  assert.equal(result.preciousMetals.references[0].referenceRubPerGram, 12100);
});

test("FX endpoint keeps foreign reference rates but marks Toman conversion unavailable without Iran dollar data", async () => {
  const url = "https://app.test/api/fx?quotes=USD,RUB,CNY";
  const context = await createSecureApiContext(url);
  const result = await withFetch(fixtureFetch(makeFixtures()), async () => {
    const response = await request(url, context);
    return await response.json();
  });
  assert.equal(result.quotes.USD.status, "unavailable");
  assert.equal(result.quotes.USD.rate, null);
  assert.equal(result.quotes.RUB.status, "available");
  assert.equal(result.quotes.RUB.rate, null);
  assert.equal(result.quotes.RUB.quotePerUsd, 81.25);
  assert.equal(result.quotes.CNY.status, "available");
  assert.equal(result.quotes.CNY.quotePerUsd, 7.12);
});

test("FX endpoint returns dated stale references after provider throttling", async () => {
  const url = "https://app.test/api/fx?quotes=USD,RUB,CNY&include=metals&usdToman=100000";
  const context = await createSecureApiContext(url);
  const fixtures = makeFixtures();
  const originalNow = Date.now;
  try {
    await withFetch(fixtureFetch(fixtures), async () => {
      const first = await request(url, context);
      assert.equal(first.status, 200);
      Date.now = () => originalNow() + 4 * DAY;
      const throttled = async () => new Response("limited", { status: 429, headers: { "retry-after": "900" } });
      const result = await withFetch(throttled, async () => {
        const response = await request(url, context);
        return await response.json();
      });
      assert.equal(result.quotes.RUB.status, "stale");
      assert.equal(result.quotes.CNY.status, "stale");
      assert.equal(result.preciousMetals.status, "stale");
      assert.equal(result.quotes.RUB.quotePerUsd, 81.25);
    });
  } finally {
    Date.now = originalNow;
  }
});
