const STORAGE_KEY = "investment-plan-history-v2";
const MARKET_CACHE_KEY = "investment-plan-market-cache-v1";

const $ = (selector) => document.querySelector(selector);
const salaryInput = $("#salary");
const rateInput = $("#contribution-rate");
const rateOutput = $("#contribution-output");
const form = $("#plan-form");
const resultPanel = $("#result-panel");
const allocationList = $("#allocation-list");
const historyList = $("#history-list");
const marketDataEl = $("#market-data");
const statusEl = $("#live-status");
const marketUpdatedEl = $("#market-updated");

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
  },
  status: {
    loading: "Reading live data...",
    connected: "Live data connected",
    cached: "Using cached data",
    unavailable: "Live data unavailable",
  },
  model: {
    base: "The base mix is designed for a calm and consistent start.",
    highStress: "Market data shows higher volatility, so the defensive allocation is slightly higher. Keep gold and currency purchases staged.",
    lowStress: "Daily volatility is currently limited, so the hedge assets receive a small increase while the portfolio remains conservative.",
    fixedIncomeAdjustment: " The published fixed-income return was also considered.",
  },
  mood: { defensive: "More defensive", balanced: "Defensive and balanced" },
  history: { empty: "No recommendation has been saved yet.", unit: "IRR", separator: " · " },
  validation: { salaryRequired: "Enter the monthly salary." },
};

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
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(Math.round(value || 0));
}

function formatPercent(value) {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(value || 0) + "\u066a";
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("fa-IR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return "Unknown";
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

function renderChange(change) {
  if (change === null || change === undefined || !Number.isFinite(Number(change))) {
    return '<span class="change-flat">' + copy.market.unknownChange + "</span>";
  }
  const number = Number(change);
  const cls = number > 0.05 ? "change-up" : number < -0.05 ? "change-down" : "change-flat";
  const sign = number > 0 ? "+" : "";
  return '<span class="' + cls + '">' + sign + formatPercent(number) + " " + copy.market.dailySuffix + "</span>";
}

function renderMarket(data) {
  if (!data || !data.assets) {
    marketDataEl.innerHTML = '<div class="empty-state">' + copy.market.noData + "</div>";
    marketUpdatedEl.textContent = copy.market.receivedNone;
    return;
  }

  const cards = [];
  const labels = copy.marketLabels;

  Object.keys(labels).forEach((key) => {
    const item = data.assets[key];
    if (!item) return;
    const label = labels[key];
    const price = item.price ? formatIRR(item.price) + " " + copy.market.priceUnit : "Unknown";
    const dot = key === "dollar" ? "currency" : key;
    cards.push(
      '<div class="market-card">' +
        '<div class="market-card-label"><span class="asset-dot asset-' + dot + '"></span><span>' + label.title + "<small>" + label.detail + "</small></span></div>" +
        '<div class="market-card-value"><strong>' + price + "</strong>" + renderChange(item.changePct) + "</div>" +
      "</div>"
    );
  });

  const fixedReturn = data.funds && data.funds.fixedIncome && data.funds.fixedIncome.effectiveAnnualReturn;
  if (fixedReturn !== null && fixedReturn !== undefined) {
    cards.push(
      '<div class="market-card">' +
        '<div class="market-card-label"><span class="asset-dot asset-fixed"></span><span>' + copy.assetMeta.fixed.title + "<small>" + copy.market.fixedIncomeDetail + "</small></span></div>" +
        '<div class="market-card-value"><strong>' + formatPercent(fixedReturn) + "</strong><span>" + copy.market.officialSource + "</span></div>" +
      "</div>"
    );
  }

  marketDataEl.innerHTML = cards.length ? cards.join("") : '<div class="empty-state">' + copy.market.noSources + "</div>";
  marketUpdatedEl.textContent = data.updatedAt
    ? copy.market.lastReadPrefix + formatDate(data.updatedAt)
    : copy.market.unknownTime;
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

function calculateAllocation() {
  const signal = getSignal();
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

  return { weights, note, stress: signal.stress };
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
    return (
      '<div class="allocation-item">' +
        '<div><div class="allocation-title"><span class="asset-dot ' + meta.dotClass + '"></span>' + meta.title + "</div>" +
        '<p class="allocation-desc">' + meta.description + "</p></div>" +
        '<div class="allocation-meta"><span class="allocation-percent">' + formatPercent(weight) + '</span><span class="allocation-amount">' + formatIRR(amount) + " " + copy.history.unit + "</span></div>" +
      "</div>"
    );
  }).join("");

  resultPanel.classList.remove("is-hidden");
  resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  saveHistory({ salary, rate, total, weights: result.weights, createdAt: new Date().toISOString() });
}

function renderHistory() {
  let history = [];
  try { history = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch {}
  if (!history.length) {
    historyList.innerHTML = '<div class="empty-state">' + copy.history.empty + "</div>";
    return;
  }
  historyList.innerHTML = history.slice(0, 8).map((item) =>
    '<div class="history-item"><span class="history-date">' + formatDate(item.createdAt) + copy.history.separator + formatPercent(item.rate) + '</span><span class="history-total">' + formatIRR(item.total) + " <small>" + copy.history.unit + "</small></span></div>"
  ).join("");
}

function saveHistory(item) {
  let history = [];
  try { history = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch {}
  history.unshift(item);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 12))); } catch {}
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
    setStatus(copy.status.connected, "success");
  } catch {
    liveMarket = readCachedMarket();
    renderMarket(liveMarket);
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