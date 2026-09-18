const STORAGE_KEY = "investment-plan-history-v3";
const MARKET_CACHE_KEY = "investment-plan-market-cache-v2";
const HISTORY_LIMIT = 36;
const DAY_MS = 24 * 60 * 60 * 1000;

const $ = (selector) => document.querySelector(selector);
const salaryInput = $("#salary");
const rateInput = $("#contribution-rate");
const rateOutput = $("#contribution-output");
const form = $("#plan-form");
const resultPanel = $("#result-panel");
const allocationList = $("#allocation-list");
const historyList = $("#history-list");
const historySummaryEl = $("#history-summary");
const historyChartEl = $("#history-chart");
const historyChartLabelEl = $("#history-chart-label");
const portfolioBreakdownEl = $("#portfolio-breakdown");
const historyDisclaimerEl = $("#history-disclaimer");
const historyCountEl = $("#history-count");
const marketDataEl = $("#market-data");
const statusEl = $("#live-status");
const marketUpdatedEl = $("#market-updated");
const marketSourceNoteEl = $("#market-source-note");

let copy = null;
let liveMarket = null;

const assetMetaFallback = {
  fixed: { title: "Fixed income", description: "The defensive part of the portfolio", dotClass: "asset-fixed" },
  gold: { title: "Gold", description: "Partial protection against purchasing-power loss", dotClass: "asset-gold" },
  currency: { title: "Currency", description: "Staged purchases instead of one-time buying", dotClass: "asset-currency" },
  silver: { title: "Silver", description: "A small, more volatile diversification position", dotClass: "asset-silver" },
};

const fallbackCopy = {
  assetMeta: assetMetaFallback,
  marketLabels: {
    dollar: { title: "Currency", detail: "Market reference rate" },
    gold: { title: "Gold", detail: "18-karat gold per gram" },
    silver: { title: "Silver", detail: "Silver per gram" },
  },
  market: {
    unknownChange: "Daily change unavailable",
    dailySuffix: "daily",
    noData: "Live data is currently unavailable; the base model can still be calculated.",
    noSources: "No live source responded.",
    priceUnit: "IRR",
    fixedIncomeDetail: "Published effective annual return",
    officialSource: "Official source",
    lastReadPrefix: "Last read: ",
    unknownTime: "Unknown retrieval time",
    receivedNone: "No data received",
    medianLabel: "Median of sources",
    sourceCount: "responsive sources",
    historyLabel: "Reference trend",
    historyMissing: "Public history unavailable",
  },
  status: { loading: "Reading live data...", connected: "Live data connected", cached: "Using cached data", unavailable: "Live data unavailable" },
  model: {
    base: "The base mix is designed for a calm and consistent start.",
    highStress: "Market data shows higher volatility, so the defensive allocation is slightly higher. Keep gold and currency purchases staged.",
    lowStress: "Daily volatility is currently limited, so the hedge assets receive a small increase while the portfolio remains conservative.",
    fixedIncomeAdjustment: " The published fixed-income return was also considered.",
    historyUsed: " Recorded prices and reference trends were also used for a limited adjustment.",
    historySparse: " Add more monthly records to make the historical signal more useful.",
  },
  mood: { defensive: "More defensive", balanced: "Defensive and balanced" },
  history: {
    empty: "No recommendation has been saved yet.", unit: "IRR", separator: " · ", contributed: "Total invested", currentValue: "Estimated current value", gain: "Estimated gain/loss", months: "Recorded months", chartLabel: "From first record to today", chartEmpty: "There is not enough data for the chart yet.", breakdownEmpty: "Record the first recommendation to see category values here.", disclaimer: "This valuation assumes that each monthly recommendation was executed; fees, bid-ask spreads, and actual product changes are not included.", details: "Monthly details", countSuffix: "records", estimated: "estimated", invested: "invested", current: "current value", gainShort: "change", noSnapshot: "Not enough price data", tracked: "tracked", notTracked: "not enough price data",
  },
  validation: { salaryRequired: "Enter the monthly salary." },
};

function escapeHTML(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeDigits(value) {
  return String(value || "")
    .replace(/[\u06f0-\u06f9]/g, (digit) => String("\u06f0\u06f1\u06f2\u06f3\u06f4\u06f5\u06f6\u06f7\u06f8\u06f9".indexOf(digit)))
    .replace(/[\u0660-\u0669]/g, (digit) => String("\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669".indexOf(digit)))
    .replace(/[\u066c\u060c,]/g, "")
    .replace(/\s/g, "");
}

function numberFromInput(value) {
  const normalized = normalizeDigits(value).replace(/[^0-9.]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatIRR(value) {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0));
}

function formatPercent(value) {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(Number(value) || 0) + "\u066a";
}

function formatCount(value) {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("fa-IR", { dateStyle: "short", timeStyle: "short" }).format(date);
  } catch {
    return "—";
  }
}

function setStatus(text, type) {
  statusEl.textContent = text;
  statusEl.className = "status-pill " + (type === "success" ? "status-success" : type === "warning" ? "status-warning" : "status-loading");
}

function updateRateOutput() {
  rateOutput.textContent = formatPercent(Number(rateInput.value));
}

function cacheMarket(data) {
  try { localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify(data)); } catch {}
}

function readCachedMarket() {
  try { return JSON.parse(localStorage.getItem(MARKET_CACHE_KEY) || "null"); } catch { return null; }
}

function readHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem("investment-plan-history-v2") || "[]");
    return Array.isArray(value) ? value.filter((item) => item && Number(item.total) > 0) : [];
  } catch {
    return [];
  }
}

function renderChange(change) {
  if (change === null || change === undefined || !Number.isFinite(Number(change))) {
    return '<span class="change-flat">' + escapeHTML(copy.market.unknownChange) + "</span>";
  }
  const number = Number(change);
  const cls = number > 0.05 ? "change-up" : number < -0.05 ? "change-down" : "change-flat";
  const sign = number > 0 ? "+" : "";
  return '<span class="' + cls + '">' + sign + formatPercent(number) + " " + escapeHTML(copy.market.dailySuffix) + "</span>";
}

function sourceCountText(item) {
  const count = Number(item && item.sourceCount);
  if (!Number.isFinite(count) || count < 1) return escapeHTML(copy.market.historyMissing);
  return '<span class="source-count">' + formatCount(count) + " " + escapeHTML(copy.market.sourceCount) + " · " + escapeHTML(copy.market.medianLabel) + "</span>";
}

function renderMarket(data) {
  if (!data || !data.assets) {
    marketDataEl.innerHTML = '<div class="empty-state">' + escapeHTML(copy.market.noData) + "</div>";
    marketUpdatedEl.textContent = copy.market.receivedNone;
    marketSourceNoteEl.textContent = copy.market.historyMissing;
    return;
  }

  const cards = [];
  Object.keys(copy.marketLabels).forEach((key) => {
    const item = data.assets[key];
    if (!item || !Number.isFinite(Number(item.price))) return;
    const label = copy.marketLabels[key];
    const dot = key === "dollar" ? "currency" : key;
    const price = formatIRR(item.price) + " " + copy.market.priceUnit;
    cards.push(
      '<div class="market-card">' +
        '<div class="market-card-label"><span class="asset-dot asset-' + dot + '"></span><span>' + escapeHTML(label.title) + "<small>" + escapeHTML(label.detail) + "</small></span></div>" +
        '<div class="market-card-value"><strong>' + price + "</strong>" + renderChange(item.changePct) + sourceCountText(item) + "</div>" +
      "</div>"
    );
  });

  const fixedIncome = data.funds && data.funds.fixedIncome;
  if (fixedIncome && Number.isFinite(Number(fixedIncome.effectiveAnnualReturn))) {
    cards.push(
      '<div class="market-card">' +
        '<div class="market-card-label"><span class="asset-dot asset-fixed"></span><span>' + escapeHTML(copy.assetMeta.fixed.title) + "<small>" + escapeHTML(copy.market.fixedIncomeDetail) + "</small></span></div>" +
        '<div class="market-card-value"><strong>' + formatPercent(fixedIncome.effectiveAnnualReturn) + "</strong><span>" + escapeHTML(copy.market.officialSource) + "</span>" + sourceCountText(fixedIncome) + "</div>" +
      "</div>"
    );
  }

  marketDataEl.innerHTML = cards.length ? cards.join("") : '<div class="empty-state">' + escapeHTML(copy.market.noSources) + "</div>";
  marketUpdatedEl.textContent = data.updatedAt ? copy.market.lastReadPrefix + formatDate(data.updatedAt) : copy.market.unknownTime;
  const sourceTotal = Object.values(data.assets).reduce((total, item) => total + (Number(item && item.sourceCount) || 0), 0);
  marketSourceNoteEl.textContent = sourceTotal ? formatCount(sourceTotal) + " " + copy.market.sourceCount : copy.market.historyMissing;
}

function snapshotMarket(data) {
  if (!data) return null;
  const snapshot = { capturedAt: data.updatedAt || new Date().toISOString(), assets: {}, funds: {} };
  ["dollar", "gold", "silver"].forEach((key) => {
    const item = data.assets && data.assets[key];
    if (item && Number.isFinite(Number(item.price))) {
      snapshot.assets[key] = { price: Number(item.price), changePct: Number.isFinite(Number(item.changePct)) ? Number(item.changePct) : null };
    }
  });
  const fixedIncome = data.funds && data.funds.fixedIncome;
  if (fixedIncome && Number.isFinite(Number(fixedIncome.effectiveAnnualReturn))) {
    snapshot.funds.fixedIncome = { effectiveAnnualReturn: Number(fixedIncome.effectiveAnnualReturn) };
  }
  return Object.keys(snapshot.assets).length || Object.keys(snapshot.funds).length ? snapshot : null;
}

function getSignal() {
  const assets = liveMarket && liveMarket.assets ? liveMarket.assets : {};
  const changes = [assets.dollar, assets.gold, assets.silver]
    .map((item) => item && Number(item.changePct))
    .filter((value) => Number.isFinite(value));
  const stress = changes.length ? Math.max.apply(null, changes.map((value) => Math.abs(value))) : 0;
  const fixedReturn = liveMarket && liveMarket.funds && liveMarket.funds.fixedIncome
    ? Number(liveMarket.funds.fixedIncome.effectiveAnnualReturn)
    : null;
  return { stress, fixedReturn };
}

function normalizeSeries(series) {
  if (!Array.isArray(series)) return [];
  return series.map((point) => {
    if (Array.isArray(point)) return { date: point[0], value: Number(point[1]) };
    if (!point || typeof point !== "object") return null;
    const date = point.date || point.time || point.timestamp || point.t;
    const value = point.value ?? point.close ?? point.price ?? point.c;
    return { date, value: Number(value) };
  }).filter((point) => point && point.date && Number.isFinite(point.value) && point.value > 0)
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
}

function getHistoricalSignal() {
  const history = readHistory().slice().sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  const metrics = {};
  const map = { dollar: "currency", gold: "gold", silver: "silver" };

  Object.entries(map).forEach(([marketKey, assetKey]) => {
    const localPoints = history.map((item) => ({ date: item.createdAt, value: Number(item.marketSnapshot && item.marketSnapshot.assets && item.marketSnapshot.assets[marketKey] && item.marketSnapshot.assets[marketKey].price) }))
      .filter((point) => point.value > 0);
    let points = localPoints;
    if (points.length < 2 && liveMarket && liveMarket.history && liveMarket.history[marketKey]) {
      points = normalizeSeries(liveMarket.history[marketKey]);
    }
    if (points.length < 2) return;
    const first = points[0].value;
    const last = points[points.length - 1].value;
    const returns = [];
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1].value;
      if (previous > 0) returns.push(points[index].value / previous - 1);
    }
    const volatility = returns.length ? Math.sqrt(returns.reduce((sum, value) => sum + value * value, 0) / returns.length) : 0;
    metrics[assetKey] = { trend: last / first - 1, volatility, observations: points.length };
  });

  const values = Object.values(metrics);
  const hedgeMetrics = [metrics.gold, metrics.currency, metrics.silver].filter(Boolean);
  return {
    available: values.length > 0,
    observations: values.length ? Math.max.apply(null, values.map((item) => item.observations)) : 0,
    metrics,
    hedgeTrend: hedgeMetrics.length ? hedgeMetrics.reduce((sum, item) => sum + item.trend, 0) / hedgeMetrics.length : 0,
    maxVolatility: values.length ? Math.max.apply(null, values.map((item) => item.volatility)) : 0,
  };
}

function calculateAllocation() {
  const signal = getSignal();
  const historical = getHistoricalSignal();
  let weights = { fixed: 66, gold: 22, currency: 9, silver: 3 };
  let note = copy.model.base;

  if (signal.stress >= 2) {
    weights = { fixed: 70, gold: 20, currency: 8, silver: 2 };
    note = copy.model.highStress;
  } else if (signal.stress > 0 && signal.stress < 0.7) {
    weights = { fixed: 64, gold: 23, currency: 10, silver: 3 };
    note = copy.model.lowStress;
  }

  if (Number.isFinite(signal.fixedReturn) && signal.fixedReturn < 25) {
    weights.fixed += 1;
    weights.gold -= 1;
    note += copy.model.fixedIncomeAdjustment;
  }

  if (historical.available) {
    if (historical.maxVolatility >= 0.12) {
      weights.fixed += 2;
      weights.gold -= 1;
      weights.silver -= 1;
    } else if (historical.hedgeTrend >= 0.08) {
      weights.fixed += 1;
      weights.gold -= 1;
    } else if (historical.hedgeTrend <= -0.08) {
      weights.fixed -= 1;
      weights.gold += 1;
    }
    note += copy.model.historyUsed;
  } else if (readHistory().length) {
    note += copy.model.historySparse;
  }

  Object.keys(weights).forEach((key) => { weights[key] = Math.max(key === "silver" ? 2 : 5, Math.round(weights[key])); });
  const difference = 100 - Object.values(weights).reduce((sum, value) => sum + value, 0);
  weights.fixed += difference;
  return { weights, note, stress: Math.max(signal.stress, historical.maxVolatility * 100), historical };
}

function renderAllocation(salary, rate) {
  const total = salary * rate / 100;
  const result = calculateAllocation();
  $("#total-investment").textContent = formatIRR(total);
  $("#total-rate").textContent = formatPercent(rate);
  $("#recommendation-mood").textContent = result.stress >= 2 ? copy.mood.defensive : copy.mood.balanced;
  $("#model-note-text").textContent = result.note;

  allocationList.innerHTML = Object.keys(result.weights).map((key) => {
    const weight = result.weights[key];
    const amount = total * weight / 100;
    const meta = copy.assetMeta[key];
    return '<div class="allocation-item"><div><div class="allocation-title"><span class="asset-dot ' + meta.dotClass + '"></span>' + escapeHTML(meta.title) + '</div><p class="allocation-desc">' + escapeHTML(meta.description) + '</p></div><div class="allocation-meta"><span class="allocation-percent">' + formatPercent(weight) + '</span><span class="allocation-amount">' + formatIRR(amount) + ' ' + escapeHTML(copy.history.unit) + '</span></div></div>';
  }).join("");

  resultPanel.classList.remove("is-hidden");
  resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  saveHistory({ salary, rate, total, weights: result.weights, createdAt: new Date().toISOString(), marketSnapshot: snapshotMarket(liveMarket), historicalSignal: result.historical });
}

function latestMarketSnapshot(history) {
  const candidates = history.filter((item) => item.marketSnapshot).sort((left, right) => new Date(right.marketSnapshot.capturedAt || right.createdAt).getTime() - new Date(left.marketSnapshot.capturedAt || left.createdAt).getTime());
  return snapshotMarket(liveMarket) || (candidates[0] && candidates[0].marketSnapshot) || null;
}

function valueForAsset(item, key, latestSnapshot) {
  const invested = Number(item.total) * Number(item.weights && item.weights[key]) / 100;
  if (!Number.isFinite(invested) || invested <= 0) return { invested: 0, current: 0, valued: false };
  const createdAt = new Date(item.createdAt).getTime();
  const latestAt = new Date((latestSnapshot && latestSnapshot.capturedAt) || new Date().toISOString()).getTime();
  const days = Math.max(0, (latestAt - (Number.isFinite(createdAt) ? createdAt : latestAt)) / DAY_MS);

  if (key === "fixed") {
    const entryReturn = Number(item.marketSnapshot && item.marketSnapshot.funds && item.marketSnapshot.funds.fixedIncome && item.marketSnapshot.funds.fixedIncome.effectiveAnnualReturn);
    const currentReturn = Number(latestSnapshot && latestSnapshot.funds && latestSnapshot.funds.fixedIncome && latestSnapshot.funds.fixedIncome.effectiveAnnualReturn);
    const annualReturn = Number.isFinite(currentReturn) ? currentReturn : entryReturn;
    if (!Number.isFinite(annualReturn)) return { invested, current: invested, valued: false };
    return { invested, current: invested * Math.pow(1 + Math.max(-.9, annualReturn / 100), days / 365), valued: true };
  }

  const marketKey = key === "currency" ? "dollar" : key;
  const entryPrice = Number(item.marketSnapshot && item.marketSnapshot.assets && item.marketSnapshot.assets[marketKey] && item.marketSnapshot.assets[marketKey].price);
  const currentPrice = Number(latestSnapshot && latestSnapshot.assets && latestSnapshot.assets[marketKey] && latestSnapshot.assets[marketKey].price);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(currentPrice) || currentPrice <= 0) return { invested, current: invested, valued: false };
  return { invested, current: invested * currentPrice / entryPrice, valued: true };
}

function calculatePortfolio(history) {
  const latestSnapshot = latestMarketSnapshot(history);
  const categories = {};
  ["fixed", "gold", "currency", "silver"].forEach((key) => { categories[key] = { invested: 0, current: 0, valuedItems: 0, totalItems: 0 }; });
  let invested = 0;
  let current = 0;
  history.forEach((item) => {
    invested += Number(item.total) || 0;
    Object.keys(categories).forEach((key) => {
      const value = valueForAsset(item, key, latestSnapshot);
      categories[key].invested += value.invested;
      categories[key].current += value.current;
      categories[key].totalItems += value.invested > 0 ? 1 : 0;
      categories[key].valuedItems += value.valued && value.invested > 0 ? 1 : 0;
    });
  });
  Object.values(categories).forEach((category) => { current += category.current; });
  return { invested, current, gain: current - invested, categories, latestSnapshot };
}

function gainClass(value) {
  return value > 0.05 ? "gain-positive" : value < -0.05 ? "gain-negative" : "gain-neutral";
}

function renderHistorySummary(history, portfolio) {
  const items = [
    [copy.history.contributed, formatIRR(portfolio.invested), copy.history.unit],
    [copy.history.currentValue, formatIRR(portfolio.current), copy.history.estimated],
    [copy.history.gain, (portfolio.gain >= 0 ? "+" : "") + formatIRR(portfolio.gain), copy.history.estimated],
    [copy.history.months, formatCount(history.length), copy.history.countSuffix],
  ];
  historySummaryEl.innerHTML = items.map((item, index) => '<div class="history-stat"><span>' + escapeHTML(item[0]) + '</span><strong class="' + (index === 2 ? gainClass(portfolio.gain) : "") + '">' + item[1] + '</strong><small>' + escapeHTML(item[2]) + '</small></div>').join("");
}

function renderHistoryChart(history) {
  if (!history.length) {
    historyChartEl.innerHTML = '<div class="empty-state">' + escapeHTML(copy.history.chartEmpty) + "</div>";
    historyChartLabelEl.textContent = "—";
    return;
  }
  const chronological = history.slice().sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  const values = chronological.map((_, index) => calculatePortfolio(chronological.slice(0, index + 1)).current);
  const max = Math.max.apply(null, values.concat([1]));
  const min = Math.min.apply(null, values.concat([0]));
  const width = 620;
  const height = 108;
  const padding = 8;
  const x = (index) => padding + (index / Math.max(1, values.length - 1)) * (width - padding * 2);
  const y = (value) => height - padding - ((value - min) / Math.max(1, max - min)) * (height - padding * 2);
  const points = values.map((value, index) => x(index).toFixed(1) + "," + y(value).toFixed(1)).join(" ");
  const areaPoints = padding + "," + (height - padding) + " " + points + " " + (width - padding) + "," + (height - padding);
  const dots = values.map((value, index) => '<circle class="chart-dot" cx="' + x(index).toFixed(1) + '" cy="' + y(value).toFixed(1) + '" r="3.5"></circle>').join("");
  historyChartEl.innerHTML = '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' + escapeHTML(copy.history.chartLabel) + '"><line class="chart-grid" x1="8" y1="27" x2="612" y2="27"></line><line class="chart-grid" x1="8" y1="81" x2="612" y2="81"></line><polygon class="chart-area" points="' + areaPoints + '"></polygon><polyline class="chart-line" points="' + points + '"></polyline>' + dots + "</svg>";
  historyChartLabelEl.textContent = copy.history.chartLabel;
}

function renderBreakdown(portfolio) {
  const keys = ["fixed", "gold", "currency", "silver"];
  if (!portfolio.invested) {
    portfolioBreakdownEl.innerHTML = '<div class="empty-state">' + escapeHTML(copy.history.breakdownEmpty) + "</div>";
    return;
  }
  portfolioBreakdownEl.innerHTML = keys.map((key) => {
    const meta = copy.assetMeta[key];
    const category = portfolio.categories[key];
    const gain = category.current - category.invested;
    const tracked = category.totalItems > 0 && category.valuedItems > 0;
    return '<div class="portfolio-row"><div class="portfolio-name"><span class="asset-dot ' + meta.dotClass + '"></span>' + escapeHTML(meta.title) + '</div><div class="portfolio-value"><strong>' + formatIRR(category.current) + " " + escapeHTML(copy.history.unit) + '</strong><small>' + escapeHTML(copy.history.current) + " · " + (tracked ? escapeHTML(copy.history.tracked) : escapeHTML(copy.history.notTracked)) + '</small></div><div class="portfolio-gain ' + gainClass(gain) + '"><strong>' + (gain >= 0 ? "+" : "") + formatIRR(gain) + '</strong><small>' + escapeHTML(copy.history.gainShort) + '</small></div></div>';
  }).join("");
}

function renderHistoryList(history, portfolio) {
  historyCountEl.textContent = history.length ? formatCount(history.length) + " " + copy.history.countSuffix : "—";
  if (!history.length) {
    historyList.innerHTML = '<div class="empty-state">' + escapeHTML(copy.history.empty) + "</div>";
    return;
  }
  const latest = portfolio.latestSnapshot;
  historyList.innerHTML = history.slice(0, 12).map((item) => {
    const itemValue = Object.keys(copy.assetMeta).reduce((sum, key) => sum + valueForAsset(item, key, latest).current, 0);
    const change = itemValue - Number(item.total);
    const valued = item.marketSnapshot && latest;
    return '<div class="history-item"><span class="history-date">' + formatDate(item.createdAt) + '<span class="history-meta">' + formatPercent(item.rate) + (valued ? "" : " · " + escapeHTML(copy.history.noSnapshot)) + '</span></span><span class="history-total ' + gainClass(change) + '">' + formatIRR(itemValue) + " <small>" + escapeHTML(copy.history.unit) + '</small><span class="history-meta">' + escapeHTML(copy.history.current) + " · " + (change >= 0 ? "+" : "") + formatIRR(change) + '</span></span></div>';
  }).join("");
}

function renderHistory() {
  const history = readHistory();
  const portfolio = calculatePortfolio(history);
  renderHistorySummary(history, portfolio);
  renderHistoryChart(history);
  renderBreakdown(portfolio);
  historyDisclaimerEl.textContent = copy.history.disclaimer;
  renderHistoryList(history, portfolio);
}

function saveHistory(item) {
  const history = readHistory();
  history.unshift(item);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT))); } catch {}
  renderHistory();
}

async function loadMarket() {
  setStatus(copy.status.loading, "loading");
  marketDataEl.innerHTML = '<div class="loading-lines"><span></span><span></span><span></span><span></span></div>';
  try {
    const response = await fetch("/api/market", { cache: "no-store" });
    if (!response.ok) throw new Error("Market request failed");
    const data = await response.json();
    liveMarket = data;
    cacheMarket(data);
    renderMarket(data);
    renderHistory();
    setStatus(copy.status.connected, "success");
  } catch {
    liveMarket = readCachedMarket();
    renderMarket(liveMarket);
    renderHistory();
    setStatus(liveMarket ? copy.status.cached : copy.status.unavailable, "warning");
  }
}

async function loadCopy() {
  try {
    const response = await fetch("content/fa.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Copy request failed");
    copy = await response.json();
  } catch {
    copy = fallbackCopy;
  }
}

function bindEvents() {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const salary = numberFromInput(salaryInput.value);
    const rate = Math.min(25, Math.max(15, Number(rateInput.value) || 20));
    if (!salary || salary <= 0) {
      salaryInput.focus();
      salaryInput.setCustomValidity(copy.validation.salaryRequired);
      salaryInput.reportValidity();
      return;
    }
    salaryInput.setCustomValidity("");
    renderAllocation(salary, rate);
  });

  salaryInput.addEventListener("input", () => salaryInput.setCustomValidity(""));
  rateInput.addEventListener("input", updateRateOutput);
  $("#refresh-market").addEventListener("click", loadMarket);
  $("#clear-history").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("investment-plan-history-v2");
    renderHistory();
  });
}

async function initialize() {
  await loadCopy();
  updateRateOutput();
  renderHistory();
  bindEvents();
  loadMarket();
}

initialize();
