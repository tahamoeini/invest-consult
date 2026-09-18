const TGJU_BASE = "https://www.tgju.org/profile/";
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
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
}

function parseNumber(value) {
  const normalized = normalizeDigits(value).replace(/[٬،,\s]/g, "").replace(/%/g, "").replace(/٪/g, "").replace(/٫/g, ".");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function firstNumberAfter(html, marker, windowSize) {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const sample = html.slice(start + marker.length, start + (windowSize || 800)).replace(/<[^>]*>/g, " ");
  const match = sample.match(/[-+]?[۰-۹٠-٩\d]+(?:[.,٫][۰-۹٠-٩\d]+)?/);
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
    /(?:بازده(?:ی)?\s*مؤثر\s*سالانه|سود\s*مؤثر\s*سالانه)[^۰-۹٠-٩\d]{0,80}([۰-۹٠-٩\d]+(?:[.,٫][۰-۹٠-٩\d]+)?)\s*(?:درصد|%|٪)/g,
    /([۰-۹٠-٩\d]+(?:[.,٫][۰-۹٠-٩\d]+)?)\s*(?:درصد|%|٪)[^]{0,20}(?:بازده(?:ی)?\s*مؤثر\s*سالانه|سود\s*مؤثر\s*سالانه)/g,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return parseNumber(match[1]);
  }
  return null;
}

async function fetchText(url) {
  const response = await fetch(url, { headers, cf: { cacheTtl: 300, cacheEverything: true } });
  if (!response.ok) throw new Error("Source returned " + response.status);
  return response.text();
}

async function getAsset(key) {
  const html = await fetchText(TGJU_BASE + sourcePages[key]);
  return parseTGJU(html, key);
}

async function getFund(category, url) {
  const html = await fetchText(url);
  return {
    category,
    effectiveAnnualReturn: findAnnualReturn(html),
    source: "صفحه رسمی ارائه‌دهنده",
    sourceUrl: url,
  };
}

function settledObject(results) {
  return Object.fromEntries(results.filter((result) => result.status === "fulfilled").map((result) => result.value));
}

export async function onRequestGet() {
  const now = new Date().toISOString();
  const assetResults = await Promise.allSettled(
    Object.keys(sourcePages).map(async (key) => [key, await getAsset(key)])
  );
  const fundResults = await Promise.allSettled(
    Object.entries(fundPages).map(async ([key, url]) => [key, await getFund(key, url)])
  );

  const body = JSON.stringify({
    updatedAt: now,
    assets: settledObject(assetResults),
    funds: settledObject(fundResults),
    sources: { market: "https://www.tgju.org/", funds: "https://charisma.ir/" },
    note: "داده‌ها از منابع عمومی خوانده شده‌اند؛ در صورت اختلال منبع، مقدار ساختگی تولید نمی‌شود.",
  });

  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "public, max-age=300, s-maxage=300",
      "access-control-allow-origin": "*",
    },
  });
}