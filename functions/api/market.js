const TGJU_BASE = "https://www.tgju.org/profile/";
const BONBAST_BASE = "https://www.bonbast.com";
const NAVASAN_RAW_BASE = "https://raw.githubusercontent.com/HosseinOdd/Navasan-API/main/data/";
const CHART_GOLD_URL = "https://www.chartgoldprice.com/api/data?history=both";
const sourcePages = { dollar: "price_dollar_rl", gold: "geram18", silver: "silver_999" };
const fundPages = {
  fixedIncome: "https://charisma.ir/funds/fixedincomefund",
  gold: "https://charisma.ir/funds/kahroba",
  silver: "https://charisma.ir/funds/noghran",
};
const headers = {
  "User-Agent": "invest-consult/1.0 (+https://github.com/tahamoeini/invest-consult)",
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

function firstNumberAfter(html, marker, windowSize) {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const sample = html.slice(start + marker.length, start + (windowSize || 800))
    .replace(/^>\s*/, "")
    .replace(/<[^>]*>/g, " ")
    .trim();
  const firstToken = sample.split(/\s+/)[0] || "";
  const match = firstToken.match(/[-+]?[0-9\u06f0-\u06f9\u0660-\u0669]+(?:[.,\u066b][0-9\u06f0-\u06f9\u0660-\u0669]+)*/);
  return match ? parseNumber(match[0]) : null;
}

function parseTGJU(html, key) {
  const price = firstNumberAfter(html, 'data-col="info.last_trade.PDrCotVal"', 500);
  const change = firstNumberAfter(html, 'data-col="info.last_trade.last_change_percentage"', 300);
  const revisionMatch = html.match(/data-revision="([^"]+)"/);
  const serverMatch = html.match(/id="server-time"[^>]+data-value="([^"]+)"/);
  if (price === null) throw new Error("No price found for " + key);
  return {
    price,
    changePct: change,
    source: "TGJU",
    sourceUrl: TGJU_BASE + sourcePages[key],
    sourceRevision: revisionMatch ? revisionMatch[1] : null,
    sourceTime: serverMatch ? serverMatch[1] : null,
  };
}

function findAnnualReturn(value) {
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

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!response.ok) throw new Error("Source returned " + response.status);
  return response.text();
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Source returned invalid JSON");
  }
}

async function getTGJUAssets() {
  const results = await Promise.allSettled(
    Object.keys(sourcePages).map(async (key) => [key, parseTGJU(await fetchText(TGJU_BASE + sourcePages[key]), key)])
  );
  return results;
}

async function getBonbastQuotes() {
  const landingResponse = await fetch(BONBAST_BASE + "/", {
    headers,
    cf: { cacheTtl: 60, cacheEverything: true },
  });
  if (!landingResponse.ok) throw new Error("Bonbast landing page returned " + landingResponse.status);
  const html = await landingResponse.text();
  const tokenMatch = html.match(/\$\.post\('\/json',\s*\{param:\s*"([^"]+)"/);
  if (!tokenMatch) throw new Error("Bonbast request token not found");
  const cookie = landingResponse.headers.get("set-cookie") || "";
  const response = await fetch(BONBAST_BASE + "/json", {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      referer: BONBAST_BASE + "/",
      ...(cookie ? { cookie } : {}),
    },
    body: "param=" + encodeURIComponent(tokenMatch[1]),
    cf: { cacheTtl: 30, cacheEverything: true },
  });
  if (!response.ok) throw new Error("Bonbast data returned " + response.status);
  const data = await response.json();
  if (data.rest || !data.usd1) throw new Error("Bonbast data was reset or incomplete");
  const sourceTime = data.last_modified || data.created || null;
  const dollar = parseNumber(data.usd1);
  const gold = parseNumber(data.gol18);
  if (!Number.isFinite(dollar) && !Number.isFinite(gold)) throw new Error("Bonbast values were empty");
  return {
    dollar: Number.isFinite(dollar) ? { price: dollar * 10, source: "Bonbast", sourceUrl: BONBAST_BASE + "/", sourceTime } : null,
    gold: Number.isFinite(gold) ? { price: gold * 10, source: "Bonbast", sourceUrl: BONBAST_BASE + "/", sourceTime } : null,
  };
}

async function getNavasanQuotes() {
  const [fiat, gold] = await Promise.all([
    fetchJson(NAVASAN_RAW_BASE + "fiat.json"),
    fetchJson(NAVASAN_RAW_BASE + "gold.json"),
  ]);
  const dollar = fiat && fiat.usd;
  const gold18 = gold && gold["18ayar"];
  const dollarValue = dollar && parseNumber(dollar.value);
  const goldValue = gold18 && parseNumber(gold18.value);
  const dollarTime = dollar && Number.isFinite(Number(dollar.date)) ? new Date(Number(dollar.date) * 1000).toISOString() : null;
  const goldTime = gold18 && Number.isFinite(Number(gold18.date)) ? new Date(Number(gold18.date) * 1000).toISOString() : null;
  if (!Number.isFinite(dollarValue) && !Number.isFinite(goldValue)) throw new Error("Navasan mirror values were empty");
  return {
    dollar: Number.isFinite(dollarValue) ? { price: dollarValue * 10, changePct: parseNumber(dollar.change_pct), source: "Navasan mirror", sourceUrl: "https://github.com/HosseinOdd/Navasan-API", sourceTime: dollarTime } : null,
    gold: Number.isFinite(goldValue) ? { price: goldValue * 10, changePct: parseNumber(gold18.change_pct), source: "Navasan mirror", sourceUrl: "https://github.com/HosseinOdd/Navasan-API", sourceTime: goldTime } : null,
  };
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
    return Object.entries(value).map(([date, point]) => ({ date, value: Number(point && typeof point === "object" ? point.close ?? point.value ?? point.price : point) }))
      .filter((point) => point.date && Number.isFinite(point.value) && point.value > 0);
  }
  return [];
}

async function getChartGoldQuotes() {
  const data = await fetchJson(CHART_GOLD_URL);
  const prices = data && data.prices ? data.prices : {};
  const goldGram = prices.gold && parseNumber(prices.gold.gram);
  const silverGram = prices.silver && parseNumber(prices.silver.gram);
  const history = data && data.history ? data.history : {};
  return {
    gold: Number.isFinite(goldGram) ? { priceUsdPerGram: goldGram } : null,
    silver: Number.isFinite(silverGram) ? { priceUsdPerGram: silverGram } : null,
    history: {
      gold: normalizeHistorySeries(history.gold || (history.series && history.series.gold)).slice(-120),
      silver: normalizeHistorySeries(history.silver || (history.series && history.series.silver)).slice(-120),
    },
    sourceTime: data && data.meta ? data.meta.updated_at || null : null,
  };
}

function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function aggregateQuotes(quotes) {
  const valid = quotes.filter((quote) => quote && Number.isFinite(Number(quote.price)) && Number(quote.price) > 0);
  if (!valid.length) return null;
  const changes = valid.map((quote) => Number(quote.changePct)).filter((value) => Number.isFinite(value));
  return {
    price: Math.round(median(valid.map((quote) => Number(quote.price)))),
    changePct: changes.length ? Number(median(changes).toFixed(3)) : null,
    sourceCount: valid.length,
    sources: valid.map((quote) => quote.source),
    sourceValues: valid.map((quote) => ({ source: quote.source, price: Math.round(Number(quote.price)) })),
    asOf: valid.map((quote) => quote.sourceTime).filter(Boolean).sort().pop() || null,
  };
}

function settledValues(results) {
  return results.filter((result) => result.status === "fulfilled").map((result) => result.value);
}

async function getFund(category, url) {
  const html = await fetchText(url);
  const effectiveAnnualReturn = findAnnualReturn(html);
  if (!Number.isFinite(effectiveAnnualReturn)) throw new Error("Annual return not found for " + category);
  return {
    category,
    effectiveAnnualReturn,
    sourceCount: 1,
    sources: ["Official provider page"],
    sourceUrl: url,
  };
}

export async function onRequestGet() {
  const now = new Date().toISOString();
  const [tgjuResults, bonbastResult, navasanResult, chartResult, fundResults] = await Promise.all([
    getTGJUAssets(),
    getBonbastQuotes().then((value) => ({ status: "fulfilled", value })).catch((reason) => ({ status: "rejected", reason })),
    getNavasanQuotes().then((value) => ({ status: "fulfilled", value })).catch((reason) => ({ status: "rejected", reason })),
    getChartGoldQuotes().then((value) => ({ status: "fulfilled", value })).catch((reason) => ({ status: "rejected", reason })),
    Promise.allSettled(Object.entries(fundPages).map(async ([key, url]) => [key, await getFund(key, url)])),
  ]);

  const tgjuQuotes = {};
  tgjuResults.filter((result) => result.status === "fulfilled").forEach((result) => {
    tgjuQuotes[result.value[0]] = result.value[1];
  });
  const bonbast = bonbastResult.status === "fulfilled" ? bonbastResult.value : {};
  const navasan = navasanResult.status === "fulfilled" ? navasanResult.value : {};
  const chart = chartResult.status === "fulfilled" ? chartResult.value : null;

  const dollar = aggregateQuotes([
    tgjuQuotes.dollar,
    bonbast.dollar,
    navasan.dollar,
  ]);
  const goldQuotes = [tgjuQuotes.gold, bonbast.gold, navasan.gold];
  const silverQuotes = [tgjuQuotes.silver];
  const history = {};

  if (chart && dollar) {
    if (chart.gold) goldQuotes.push({ price: chart.gold.priceUsdPerGram * dollar.price * 0.75, source: "ChartGoldPrice", sourceUrl: "https://www.chartgoldprice.com/api/data", sourceTime: chart.sourceTime });
    if (chart.silver) silverQuotes.push({ price: chart.silver.priceUsdPerGram * dollar.price, source: "ChartGoldPrice", sourceUrl: "https://www.chartgoldprice.com/api/data", sourceTime: chart.sourceTime });
    ["gold", "silver"].forEach((key) => {
      const series = chart.history[key] || [];
      if (series.length) history[key] = series.map((point) => ({ date: point.date, price: Math.round(point.value * dollar.price * (key === "gold" ? 0.75 : 1)), source: "ChartGoldPrice" }));
    });
  }

  const assets = {};
  if (dollar) assets.dollar = dollar;
  const gold = aggregateQuotes(goldQuotes);
  const silver = aggregateQuotes(silverQuotes);
  if (gold) assets.gold = gold;
  if (silver) assets.silver = silver;

  const funds = Object.fromEntries(
    settledValues(fundResults).map((result) => result).filter((entry) => Array.isArray(entry) && entry.length === 2)
  );
  const diagnostics = {
    dollar: { attempted: 3, successful: dollar ? dollar.sourceCount : 0 },
    gold: { attempted: 4, successful: gold ? gold.sourceCount : 0 },
    silver: { attempted: 2, successful: silver ? silver.sourceCount : 0 },
  };

  return new Response(JSON.stringify({
    updatedAt: now,
    assets,
    funds,
    history,
    diagnostics,
    sources: {
      market: [
        { name: "TGJU", url: "https://www.tgju.org/" },
        { name: "Bonbast", url: BONBAST_BASE + "/" },
        { name: "Navasan mirror", url: "https://github.com/HosseinOdd/Navasan-API" },
        { name: "ChartGoldPrice", url: "https://www.chartgoldprice.com/gold-price-api" },
      ],
      funds: "https://charisma.ir/",
    },
    note: "Each asset uses the median of valid responsive quotes. Failed sources are omitted without synthetic values; some global metal quotes are converted to IRR using the aggregated dollar quote.",
  }), {
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "public, max-age=300, s-maxage=300",
      "access-control-allow-origin": "*",
    },
  });
}
