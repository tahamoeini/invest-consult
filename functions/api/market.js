const TGJU_BASE = "https://www.tgju.org/profile/";
const BONBAST_BASE = "https://www.bonbast.com";
const NAVASAN_RAW_BASE = "https://raw.githubusercontent.com/HosseinOdd/Navasan-API/main/data/";
const CHART_GOLD_URL = "https://www.chartgoldprice.com/api/data?history=both";
const sourcePages = { dollar: "price_dollar_rl", gold: "geram18", silver: "silver_999" };
const fundPages = { fixedIncome: "https://charisma.ir/funds/fixedincomefund" };
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

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { ...headers, ...(options.headers || {}) },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!response.ok) throw new Error(`Source returned ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options);
  try { return JSON.parse(text); } catch { throw new Error("Source returned invalid JSON"); }
}

async function providerA() {
  const results = await Promise.all(Object.entries(sourcePages).map(async ([asset, page]) => {
    const html = await fetchText(TGJU_BASE + page);
    const price = firstNumberAfter(html, 'data-col="info.last_trade.PDrCotVal"', 500);
    const changePct = firstNumberAfter(html, 'data-col="info.last_trade.last_change_percentage"', 300);
    const revision = html.match(/data-revision="([^"]+)"/);
    const serverTime = html.match(/id="server-time"[^>]+data-value="([^"]+)"/);
    const item = quote(asset, price, "Provider A", { changePct, sourceUrl: TGJU_BASE + page, sourceTime: serverTime ? serverTime[1] : null, sourceRevision: revision ? revision[1] : null });
    if (!item) throw new Error(`No normalized quote for ${asset}`);
    return item;
  }));
  return results;
}

async function providerB() {
  const landing = await fetch(BONBAST_BASE + "/", { headers, cf: { cacheTtl: 60, cacheEverything: true } });
  if (!landing.ok) throw new Error(`Landing page returned ${landing.status}`);
  const html = await landing.text();
  const tokenMatch = html.match(/\$\.post\('\/json',\s*\{param:\s*"([^"]+)"/);
  if (!tokenMatch) throw new Error("Request token not found");
  const cookie = landing.headers.get("set-cookie") || "";
  const response = await fetch(BONBAST_BASE + "/json", {
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
    quote("dollar", parseNumber(data.usd1) * 10, "Provider B", { sourceUrl: BONBAST_BASE + "/", sourceTime }),
    quote("gold", parseNumber(data.gol18) * 10, "Provider B", { sourceUrl: BONBAST_BASE + "/", sourceTime }),
  ].filter(Boolean);
}

async function providerC() {
  const [fiat, gold] = await Promise.all([fetchJson(NAVASAN_RAW_BASE + "fiat.json"), fetchJson(NAVASAN_RAW_BASE + "gold.json")]);
  const dollar = fiat && fiat.usd;
  const gold18 = gold && gold["18ayar"];
  const dollarTime = dollar && Number.isFinite(Number(dollar.date)) ? new Date(Number(dollar.date) * 1000).toISOString() : null;
  const goldTime = gold18 && Number.isFinite(Number(gold18.date)) ? new Date(Number(gold18.date) * 1000).toISOString() : null;
  return [
    quote("dollar", parseNumber(dollar && dollar.value) * 10, "Provider C", { changePct: parseNumber(dollar && dollar.change_pct), sourceUrl: "https://github.com/HosseinOdd/Navasan-API", sourceTime: dollarTime }),
    quote("gold", parseNumber(gold18 && gold18.value) * 10, "Provider C", { changePct: parseNumber(gold18 && gold18.change_pct), sourceUrl: "https://github.com/HosseinOdd/Navasan-API", sourceTime: goldTime }),
  ].filter(Boolean);
}

const providers = [
  { id: "providerA", run: providerA },
  { id: "providerB", run: providerB },
  { id: "providerC", run: providerC },
];

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

async function getAuxiliaryMetalData() {
  const data = await fetchJson(CHART_GOLD_URL);
  const prices = data && data.prices ? data.prices : {};
  const history = data && data.history ? data.history : {};
  return {
    goldUsdPerGram: parseNumber(prices.gold && prices.gold.gram),
    silverUsdPerGram: parseNumber(prices.silver && prices.silver.gram),
    history: {
      gold: normalizeHistorySeries(history.gold || (history.series && history.series.gold)).slice(-180),
      silver: normalizeHistorySeries(history.silver || (history.series && history.series.silver)).slice(-180),
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

function aggregate(asset, quotes) {
  const valid = quotes.filter((item) => item && item.asset === asset && Number.isFinite(Number(item.price)) && Number(item.price) > 0);
  if (!valid.length) return null;
  const changes = valid.map((item) => Number(item.changePct)).filter(Number.isFinite);
  return {
    price: Math.round(median(valid.map((item) => item.price))),
    changePct: changes.length ? Number(median(changes).toFixed(3)) : null,
    sourceCount: valid.length,
    sources: valid.map((item) => item.source),
    sourceValues: valid.map((item) => ({ source: item.source, price: Math.round(item.price) })),
    asOf: valid.map((item) => item.sourceTime).filter(Boolean).sort().pop() || null,
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
  const providerResults = await Promise.allSettled(providers.map((provider) => provider.run().then((quotes) => ({ id: provider.id, quotes }))));
  const quoteSets = settledValues(providerResults);
  const providerDiagnostics = Object.fromEntries(providers.map((provider, index) => {
    const result = providerResults[index];
    return [provider.id, { status: result.status, quoteCount: result.status === "fulfilled" ? result.value.quotes.length : 0 }];
  }));
  const quotes = quoteSets.flatMap((set) => set.quotes);
  let auxiliary = null;
  try { auxiliary = await getAuxiliaryMetalData(); } catch { auxiliary = null; }
  const dollar = aggregate("dollar", quotes);
  const goldQuotes = quotes.filter((item) => item.asset === "gold");
  const silverQuotes = quotes.filter((item) => item.asset === "silver");
  if (auxiliary && dollar) {
    if (Number.isFinite(auxiliary.goldUsdPerGram)) goldQuotes.push(quote("gold", auxiliary.goldUsdPerGram * dollar.price * 0.75, "Auxiliary metal source", { sourceUrl: CHART_GOLD_URL, sourceTime: auxiliary.sourceTime }));
    if (Number.isFinite(auxiliary.silverUsdPerGram)) silverQuotes.push(quote("silver", auxiliary.silverUsdPerGram * dollar.price, "Auxiliary metal source", { sourceUrl: CHART_GOLD_URL, sourceTime: auxiliary.sourceTime }));
  }
  const assets = {};
  if (dollar) assets.dollar = dollar;
  const gold = aggregate("gold", goldQuotes);
  const silver = aggregate("silver", silverQuotes);
  if (gold) assets.gold = gold;
  if (silver) assets.silver = silver;

  const history = {};
  if (auxiliary && dollar) {
    ["gold", "silver"].forEach((asset) => {
      const series = auxiliary.history[asset] || [];
      if (series.length) history[asset] = series.map((point) => ({ date: point.date, price: Math.round(point.value * dollar.price * (asset === "gold" ? 0.75 : 1)), source: "Auxiliary metal source" }));
    });
  }

  let fixedIncome = null;
  try { fixedIncome = await getFixedIncomeMetric(); } catch { fixedIncome = null; }
  const funds = fixedIncome ? { fixedIncome } : {};
  const diagnostics = {
    providers: providerDiagnostics,
    assets: {
      dollar: { attempted: providers.length, successful: dollar ? dollar.sourceCount : 0 },
      gold: { attempted: providers.length + 1, successful: gold ? gold.sourceCount : 0 },
      silver: { attempted: 2, successful: silver ? silver.sourceCount : 0 },
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
      ],
      fixedIncome: "https://charisma.ir/",
    },
    note: "Each asset is normalized to IRR and aggregated with the median of valid responsive quotes. Failed providers are omitted without synthetic or stale values.",
  }), {
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "public, max-age=300, s-maxage=300",
      "access-control-allow-origin": "*",
    },
  });
}
