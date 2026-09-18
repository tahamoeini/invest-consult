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
    source: "Official provider page",
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
    note: "Data is read from public sources; unavailable sources are omitted without synthetic values.",
  });

  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "public, max-age=300, s-maxage=300",
      "access-control-allow-origin": "*",
    },
  });
}