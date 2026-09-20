const TGJU_BASE = "https://www.tgju.org/profile/";
const BONBAST_BASE = "https://www.bonbast.com";
const NAVASAN_RAW_BASE = "https://raw.githubusercontent.com/HosseinOdd/Navasan-API/main/data/";
const CHART_GOLD_URL = "https://www.chartgoldprice.com/api/data?history=both";
const COINGECKO_SIMPLE_URL = "https://api.coingecko.com/api/v3/simple/price";
const BINANCE_TICKER_URL = "https://api.binance.com/api/v3/ticker/24hr";
const METALS_LIVE_URL = "https://api.metals.live/v1/spot";
const TSETMC_INDEX_URL = "https://cdn.tsetmc.com/api/Index/GetIndexB1LastDay";
const TROY_OUNCE_TO_GRAMS = 31.1034768;
const sourcePages = { dollar: "price_dollar_rl", gold: "geram18", silver: "silver_999" };
const fundPages = { fixedIncome: "https://charisma.ir/funds/fixedincomefund" };
// Public pages can be slow from Iranian networks. Keep the browser timeout
// budget (12s) larger than this provider budget so partial fallback data can
// still reach the client instead of looking like a failed price request.
const UPSTREAM_TIMEOUT_MS = 7500;
const headers = {
  "User-Agent": "invest-consult/2.0 (+https://github.com/tahamoeini/invest-consult)",
  "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
};

function normalizeDigits(value) {
  return String(value || "")
    .replace(/[\u06f0-\u06f9]/g, (digit) => String("\u06f0\u06f1\u06f2\u06f3\u06f4\u06f5\u06f6\u06f7\u06f8\u06f9".indexOf(digit)))
    .replace(/[\u0660-\u0669]/g, (digit) => String("\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669".indexOf(digit)));
}

function parseNumber(value) {
  const normalized = normalizeDigits(value)
    .replace(/[\u066c\u060c,\s]/g, "")
    .replace(/%/g, "")
    .replace(/\u066a/g, "")
    .replace(/\u066b/g, ".");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function firstNumberAfter(html, marker, windowSize = 800) {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const sample = html.slice(start + marker.length, start + windowSize).replace(/^>\s*/, "").replace(/<[^>]*>/g, " ").trim();
  const token = sample.split(/\s+/)[0] || "";
  const match = token.match(/[-+]?[0-9\u06f0-\u06f9\u0660-\u0669]+(?:[.,\u066b][0-9\u06f0-\u06f9\u0660-\u0669]+)*/);
  return match ? parseNumber(match[0]) : null;
}

function quote(asset, price, source, metadata = {}) {
  if (!Number.isFinite(Number(price)) || Number(price) <= 0) return null;
  return { asset, price: Number(price), source, ...metadata };
}

async function fetchResponse(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { ...headers, ...(options.headers || {}) },
      cf: { cacheTtl: 300, cacheEverything: true, ...(options.cf || {}) },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url, options = {}) {
  const response = await fetchResponse(url, options);
  if (!response.ok) throw new Error(`Source returned ${response.status}`);
  return await response.text();
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options);
  try { return JSON.parse(text); } catch { throw new Error("Source returned invalid JSON"); }
}

async function providerA() {
  const results = await Promise.allSettled(Object.entries(sourcePages).map(async ([asset, page]) => {
    const html = await fetchText(TGJU_BASE + page);
    const price = firstNumberAfter(html, 'data-col="info.last_trade.PDrCotVal"', 500);
    const changePct = firstNumberAfter(html, 'data-col="info.last_trade.last_change_percentage"', 300);
    const revision = html.match(/data-revision="([^"]+)"/);
    const serverTime = html.match(/id="server-time"[^>]+data-value="([^"]+)"/);
    const item = quote(asset, price / 10, "Provider A", { changePct, sourceUrl: TGJU_BASE + page, sourceTime: serverTime ? serverTime[1] : null, sourceRevision: revision ? revision[1] : null });
    if (!item) throw new Error(`No normalized quote for ${asset}`);
    return { item, history: normalizeTgjuHistory(extractTgjuChartData(html)) };
  }));
  const fulfilled = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
  if (!fulfilled.length) throw new Error("No TGJU quote pages responded");
  return {
    quotes: fulfilled.map((result) => result.item),
    history: Object.fromEntries(fulfilled.map((result) => [result.item.asset, result.history])),
  };
}

async function providerB() {
  const landing = await fetchResponse(BONBAST_BASE + "/", { cf: { cacheTtl: 60, cacheEverything: true } });
  if (!landing.ok) throw new Error(`Landing page returned ${landing.status}`);
  const html = await landing.text();
  const tokenMatch = html.match(/\$\.post\('\/json',\s*\{param:\s*"([^"]+)"/);
  if (!tokenMatch) throw new Error("Request token not found");
  const cookie = landing.headers.get("set-cookie") || "";
  const response = await fetchResponse(BONBAST_BASE + "/json", {
    method: "POST",
    headers: { ...headers, "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest", referer: BONBAST_BASE + "/", ...(cookie ? { cookie } : {}) },
    body: "param=" + encodeURIComponent(tokenMatch[1]),
    cf: { cacheTtl: 60, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`Quote request returned ${response.status}`);
  const data = await response.json();
  if (data.rest || !data.usd1) throw new Error("Quote response was incomplete");
  const sourceTime = data.last_modified || data.created || null;
  return [
    quote("dollar", parseNumber(data.usd1), "Provider B", { sourceUrl: BONBAST_BASE + "/", sourceTime }),
    quote("gold", parseNumber(data.gol18), "Provider B", { sourceUrl: BONBAST_BASE + "/", sourceTime }),
  ].filter(Boolean);
}

async function providerC() {
  const [fiat, gold] = await Promise.all([fetchJson(NAVASAN_RAW_BASE + "fiat.json"), fetchJson(NAVASAN_RAW_BASE + "gold.json")]);
  const dollar = fiat && fiat.usd;
  const gold18 = gold && gold["18ayar"];
  const dollarTime = dollar && Number.isFinite(Number(dollar.date)) ? new Date(Number(dollar.date) * 1000).toISOString() : null;
  const goldTime = gold18 && Number.isFinite(Number(gold18.date)) ? new Date(Number(gold18.date) * 1000).toISOString() : null;
  return [
    quote("dollar", parseNumber(dollar && dollar.value), "Provider C", { changePct: parseNumber(dollar && dollar.change_pct), sourceUrl: "https://github.com/HosseinOdd/Navasan-API", sourceTime: dollarTime }),
    quote("gold", parseNumber(gold18 && gold18.value), "Provider C", { changePct: parseNumber(gold18 && gold18.change_pct), sourceUrl: "https://github.com/HosseinOdd/Navasan-API", sourceTime: goldTime }),
  ].filter(Boolean);
}

const providers = [
  { id: "providerA", run: providerA },
  { id: "providerB", run: providerB },
  { id: "providerC", run: providerC },
];

async function providerCrypto(dollarPrice) {
  if (!Number.isFinite(Number(dollarPrice)) || Number(dollarPrice) <= 0) return [];
  const url = COINGECKO_SIMPLE_URL + "?ids=bitcoin,ethereum,tether&vs_currencies=usd&include_24hr_change=true";
  const data = await fetchJson(url);
  const mapping = { bitcoin: "bitcoin", ethereum: "ethereum", tether: "tether" };
  return Object.entries(mapping).map(([id, asset]) => {
    const item = data && data[id];
    if (!item) return null;
    const usd = parseNumber(item.usd);
    return quote(asset, usd * Number(dollarPrice), "CoinGecko", {
      changePct: parseNumber(item.usd_24h_change),
      sourceUrl: url,
      sourceTime: null,
      unit: "coin",
      currency: "TOMAN",
    });
  }).filter(Boolean);
}

async function providerCryptoBinance(dollarPrice) {
  if (!Number.isFinite(Number(dollarPrice)) || Number(dollarPrice) <= 0) return [];
  const symbols = ["BTCUSDT", "ETHUSDT"];
  const url = BINANCE_TICKER_URL + "?symbols=" + encodeURIComponent(JSON.stringify(symbols));
  const data = await fetchJson(url);
  const mapping = { BTCUSDT: "bitcoin", ETHUSDT: "ethereum" };
  return (Array.isArray(data) ? data : []).map((item) => {
    const asset = mapping[item && item.symbol];
    if (!asset) return null;
    const usd = parseNumber(item.lastPrice);
    return quote(asset, usd * Number(dollarPrice), "Binance", {
      changePct: parseNumber(item.priceChangePercent),
      sourceUrl: url,
      sourceTime: null,
      unit: "coin",
      currency: "TOMAN",
    });
  }).filter(Boolean);
}

function nestedNumber(value, keys, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const item of value.slice().reverse()) {
      const found = nestedNumber(item, keys, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value)) {
    if (keys.includes(key)) {
      const found = parseNumber(item);
      if (Number.isFinite(found) && found > 0) return found;
    }
  }
  for (const item of Object.values(value)) {
    const found = nestedNumber(item, keys, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

async function providerGlobalMetals(dollarPrice) {
  if (!Number.isFinite(Number(dollarPrice)) || Number(dollarPrice) <= 0) return [];
  const data = await fetchJson(METALS_LIVE_URL);
  const row = Array.isArray(data) ? data.at(-1) : data;
  const conversions = {
    gold: { factor: 0.75, unit: "gram" },
    silver: { factor: 1, unit: "gram" },
    platinum: { factor: 1, unit: "gram" },
    palladium: { factor: 1, unit: "gram" },
    copper: { factor: 1, unit: "gram" },
  };
  return Object.entries(conversions).map(([asset, meta]) => {
    const ounceUsd = parseNumber(row && row[asset]);
    if (!Number.isFinite(ounceUsd) || ounceUsd <= 0) return null;
    return quote(asset, ounceUsd * Number(dollarPrice) * meta.factor / TROY_OUNCE_TO_GRAMS, "Metals.live", {
      sourceUrl: METALS_LIVE_URL,
      sourceTime: null,
      unit: meta.unit,
      currency: "TOMAN",
    });
  }).filter(Boolean);
}

async function providerTsetmc() {
  const data = await fetchJson(TSETMC_INDEX_URL);
  const current = nestedNumber(data, ["xNivIn", "indexValue", "currentValue", "lastValue", "value"]);
  if (!Number.isFinite(current) || current <= 0) throw new Error("TSETMC index value not found");
  const previous = nestedNumber(data, ["xNivInPre", "previousValue", "yesterdayValue", "prevValue"]);
  const changePct = Number.isFinite(previous) && previous > 0 ? (current / previous - 1) * 100 : null;
  return [quote("bourseIndex", current, "TSETMC", {
    changePct,
    sourceUrl: TSETMC_INDEX_URL,
    sourceTime: new Date().toISOString(),
    unit: "point",
    currency: "INDEX",
  })];
}

function normalizeHistorySeries(value) {
  if (Array.isArray(value)) {
    return value.map((point) => {
      if (Array.isArray(point)) return { date: point[0], value: Number(point[1]) };
      if (!point || typeof point !== "object") return null;
      return { date: point.date || point.time || point.timestamp || point.t, value: Number(point.close ?? point.value ?? point.price ?? point.c) };
    }).filter((point) => point && point.date && Number.isFinite(point.value) && point.value > 0);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).map(([date, point]) => ({ date, value: Number(point && typeof point === "object" ? point.close ?? point.value ?? point.price : point) })).filter((point) => point.date && Number.isFinite(point.value) && point.value > 0);
  }
  return [];
}

export function normalizeMetalHistory(value) {
  return normalizeHistorySeries(value).map((point) => ({ ...point, value: point.value / TROY_OUNCE_TO_GRAMS }));
}

function readBalancedArray(text, startIndex) {
  let depth = 0;
  let quoteChar = null;
  let escaped = false;
  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];
    if (quoteChar) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quoteChar) quoteChar = null;
      continue;
    }
    if (character === "\"" || character === "'") {
      quoteChar = character;
      continue;
    }
    if (character === "[") depth += 1;
    if (character === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(startIndex, index + 1);
    }
  }
  return null;
}

export function extractTgjuChartData(html, blockId = "ChartBlock-3") {
  const markerIndex = String(html || "").indexOf(`#${blockId}").msHighcharts({`);
  if (markerIndex < 0) return [];
  const dataIndex = String(html).indexOf("chartData:", markerIndex);
  if (dataIndex < 0) return [];
  const arrayStart = String(html).indexOf("[", dataIndex);
  if (arrayStart < 0) return [];
  const raw = readBalancedArray(String(html), arrayStart);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function normalizeTgjuHistory(value) {
  return normalizeHistorySeries(value)
    .map((point) => ({ ...point, value: point.value / 10 }))
    .filter((point) => Number.isFinite(point.value) && point.value > 0);
}

async function getAuxiliaryMetalData() {
  const data = await fetchJson(CHART_GOLD_URL);
  const prices = data && data.prices ? data.prices : {};
  const history = data && data.history ? data.history : {};
  return {
    goldUsdPerGram: parseNumber(prices.gold && prices.gold.gram),
    silverUsdPerGram: parseNumber(prices.silver && prices.silver.gram),
    history: {
      gold: normalizeMetalHistory(history.gold || (history.series && history.series.gold)).slice(-180),
      silver: normalizeMetalHistory(history.silver || (history.series && history.series.silver)).slice(-180),
    },
    sourceTime: data && data.meta ? data.meta.updated_at || null : null,
  };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function aggregate(asset, quotes) {
  const valid = quotes.filter((item) => item && item.asset === asset && Number.isFinite(Number(item.price)) && Number(item.price) > 0);
  if (!valid.length) return null;
  const changes = valid
    .map((item) => item.changePct)
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number)
    .filter(Number.isFinite);
  const sourceTimes = valid.map((item) => item.sourceTime).filter(Boolean).sort((left, right) => {
    const leftTime = new Date(left).getTime();
    const rightTime = new Date(right).getTime();
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime;
    return String(left).localeCompare(String(right));
  });
  return {
    price: Math.round(median(valid.map((item) => item.price))),
    changePct: changes.length ? Number(median(changes).toFixed(3)) : null,
    sourceCount: valid.length,
    sources: valid.map((item) => item.source),
    sourceValues: valid.map((item) => ({ source: item.source, price: Math.round(item.price) })),
    asOf: sourceTimes.at(-1) || null,
  };
}

function parseAnnualReturn(value) {
  const text = String(value || "");
  const patterns = [
    /(?:\u0628\u0627\u0632\u062f\u0647(?:\u06cc)?\s*\u0645\u0624\u062b\u0631\s*\u0633\u0627\u0644\u0627\u0646\u0647|\u0633\u0648\u062f\s*\u0645\u0624\u062b\u0631\s*\u0633\u0627\u0644\u0627\u0646\u0647)[^\u06f0-\u06f9\u0660-\u0669\d]{0,80}([\u06f0-\u06f9\u0660-\u0669\d]+(?:[.,\u066b][\u06f0-\u06f9\u0660-\u0669\d]+)?)\s*(?:\u062f\u0631\u0635\u062f|%|\u066a)/g,
    /([\u06f0-\u06f9\u0660-\u0669\d]+(?:[.,\u066b][\u06f0-\u06f9\u0660-\u0669\d]+)?)\s*(?:\u062f\u0631\u0635\u062f|%|\u066a)[^]{0,20}(?:\u0628\u0627\u0632\u062f\u0647(?:\u06cc)?\s*\u0645\u0624\u062b\u0631\s*\u0633\u0627\u0644\u0627\u0646\u0647|\u0633\u0648\u062f\s*\u0645\u0624\u062b\u0631\s*\u0633\u0627\u0644\u0627\u0646\u0647)/g,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return parseNumber(match[1]);
  }
  return null;
}

async function getFixedIncomeMetric() {
  const url = fundPages.fixedIncome;
  const html = await fetchText(url);
  const effectiveAnnualReturn = parseAnnualReturn(html);
  if (!Number.isFinite(effectiveAnnualReturn)) throw new Error("Annual return not found");
  return { effectiveAnnualReturn, sourceCount: 1, sources: ["Official provider page"], sourceUrl: url };
}

function settledValues(results) {
  return results.filter((result) => result.status === "fulfilled").map((result) => result.value);
}

export async function onRequestGet() {
  const now = new Date().toISOString();
  const providerResultsPromise = Promise.allSettled(providers.map(async (provider) => {
    const result = await provider.run();
    return {
      id: provider.id,
      quotes: Array.isArray(result) ? result : result.quotes || [],
      history: Array.isArray(result) ? {} : result.history || {},
    };
  }));
  const auxiliaryPromise = getAuxiliaryMetalData().catch(() => null);
  const fixedIncomePromise = getFixedIncomeMetric().catch(() => null);
  const [providerResults, auxiliary, fixedIncome] = await Promise.all([providerResultsPromise, auxiliaryPromise, fixedIncomePromise]);
  const quoteSets = settledValues(providerResults);
  const providerDiagnostics = Object.fromEntries(providers.map((provider, index) => {
    const result = providerResults[index];
    return [provider.id, { status: result.status, quoteCount: result.status === "fulfilled" ? result.value.quotes.length : 0 }];
  }));
  const baseQuotes = quoteSets.flatMap((set) => set.quotes);
  const baseDollar = aggregate("dollar", baseQuotes);
  const extendedDefinitions = [
    { id: "coinGecko", run: () => providerCrypto(baseDollar && baseDollar.price) },
    { id: "binance", run: () => providerCryptoBinance(baseDollar && baseDollar.price) },
    { id: "metalsLive", run: () => providerGlobalMetals(baseDollar && baseDollar.price) },
    { id: "tsetmc", run: providerTsetmc },
  ];
  const extendedResults = await Promise.allSettled(extendedDefinitions.map((provider) => provider.run()));
  const extendedQuotes = extendedResults.flatMap((result) => result.status === "fulfilled" && Array.isArray(result.value) ? result.value : []);
  const quotes = [...baseQuotes, ...extendedQuotes];
  const dollar = aggregate("dollar", quotes);
  const goldQuotes = quotes.filter((item) => item.asset === "gold");
  const silverQuotes = quotes.filter((item) => item.asset === "silver");
  if (auxiliary && dollar) {
    if (Number.isFinite(auxiliary.goldUsdPerGram)) goldQuotes.push(quote("gold", auxiliary.goldUsdPerGram * dollar.price * 0.75, "Auxiliary metal source", { sourceUrl: CHART_GOLD_URL, sourceTime: auxiliary.sourceTime }));
    if (Number.isFinite(auxiliary.silverUsdPerGram)) silverQuotes.push(quote("silver", auxiliary.silverUsdPerGram * dollar.price, "Auxiliary metal source", { sourceUrl: CHART_GOLD_URL, sourceTime: auxiliary.sourceTime }));
  }
  const assets = {};
  if (dollar) assets.dollar = dollar;
  const aggregateAssets = ["gold", "silver", "bitcoin", "ethereum", "tether", "platinum", "palladium", "copper", "bourseIndex"];
  aggregateAssets.forEach((asset) => {
    const assetQuotes = asset === "gold" ? goldQuotes : asset === "silver" ? silverQuotes : quotes;
    const aggregated = aggregate(asset, assetQuotes);
    if (aggregated) assets[asset] = aggregated;
  });

  const history = {};
  const tgjuHistory = quoteSets.find((set) => set.id === "providerA")?.history || {};
  ["dollar", "gold", "silver"].forEach((asset) => {
    const series = tgjuHistory[asset] || [];
    if (series.length) history[asset] = series.map((point) => ({ date: point.date, price: Math.round(point.value), source: "Provider A" }));
  });

  const funds = fixedIncome ? { fixedIncome } : {};
  const diagnostics = {
    providers: {
      ...providerDiagnostics,
      ...Object.fromEntries(extendedDefinitions.map((provider, index) => {
        const result = extendedResults[index];
        return [provider.id, { status: result.status, quoteCount: result.status === "fulfilled" ? result.value.length : 0 }];
      })),
    },
    assets: {
      dollar: { attempted: providers.length, successful: assets.dollar ? assets.dollar.sourceCount : 0 },
      gold: { attempted: providers.length + 2, successful: assets.gold ? assets.gold.sourceCount : 0 },
      silver: { attempted: providers.length + 2, successful: assets.silver ? assets.silver.sourceCount : 0 },
      bitcoin: { attempted: 2, successful: assets.bitcoin ? assets.bitcoin.sourceCount : 0 },
      ethereum: { attempted: 2, successful: assets.ethereum ? assets.ethereum.sourceCount : 0 },
      tether: { attempted: 1, successful: assets.tether ? assets.tether.sourceCount : 0 },
      platinum: { attempted: 1, successful: assets.platinum ? assets.platinum.sourceCount : 0 },
      palladium: { attempted: 1, successful: assets.palladium ? assets.palladium.sourceCount : 0 },
      copper: { attempted: 1, successful: assets.copper ? assets.copper.sourceCount : 0 },
      bourseIndex: { attempted: 1, successful: assets.bourseIndex ? assets.bourseIndex.sourceCount : 0 },
    },
  };

  return new Response(JSON.stringify({
    updatedAt: now,
    assets,
    funds,
    history,
    diagnostics,
    sources: {
      providers: [
        { id: "providerA", name: "TGJU", url: "https://www.tgju.org/" },
        { id: "providerB", name: "Bonbast", url: BONBAST_BASE + "/" },
        { id: "providerC", name: "Navasan public mirror", url: "https://github.com/HosseinOdd/Navasan-API" },
        { id: "auxiliary", name: "ChartGoldPrice", url: "https://www.chartgoldprice.com/gold-price-api" },
        { id: "coinGecko", name: "CoinGecko", url: COINGECKO_SIMPLE_URL },
        { id: "binance", name: "Binance public ticker", url: BINANCE_TICKER_URL },
        { id: "metalsLive", name: "Metals.live", url: METALS_LIVE_URL },
        { id: "tsetmc", name: "TSETMC", url: TSETMC_INDEX_URL },
      ],
      fixedIncome: "https://charisma.ir/",
      history: "https://www.tgju.org/",
    },
    note: "Domestic prices are normalized to Toman. Crypto and global metals are converted through the domestic dollar quote and aggregated only when independent public providers respond. Tehran market data remains an index-point reference. Failed providers are omitted without synthetic or stale values; no model forecast is used as a current price.",
  }), {
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "public, max-age=300, s-maxage=300",
      "access-control-allow-origin": "*",
    },
  });
}
