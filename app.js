// @ts-check

import {
  ASSET_KEYS,
  DEFAULT_ASSUMPTIONS,
  backtestHistorical,
  clamp,
  contributionRebalance,
  estimateReturnModel,
  portfolioFromHistory,
  recommendAllocation,
  runMonteCarlo,
  simulatePlan,
} from "./src/engine.js";
import {
  createHistoryExport,
  mergeHistory,
  parseHistoryExport,
} from "./src/history.js";
import {
  SIMPLE_ASSET_IDS,
  activePortfolioVersion,
  appendTransactions,
  assetIds,
  calculatePortfolio,
  createPortfolioAsset,
  createPortfolioVersion,
  createTransaction,
  normalizePortfolio,
  portfolioSeries,
  simpleChangeTransactions,
} from "./src/portfolio.js";
import { AppShell } from "./src/ui/components.js";
import { donutChartMarkup, lineChartMarkup, normalizeSeriesIndex } from "./src/ui/charts.js";
import { createNavigationController } from "./src/ui/navigation.js";
import { createAppStore } from "./src/ui/state.js";

const HISTORY_KEY = "investment-plan-history-v4";
const MARKET_CACHE_KEY = "investment-plan-market-cache-v3";
const PROFILE_KEY = "investment-plan-profile-v1";
const PORTFOLIO_KEY = "invest-consult-portfolio-v1";
const HISTORY_LIMIT = 60;
const MARKET_REQUEST_TIMEOUT_MS = 12000;
const CURRENCY_MIGRATION_KEY = "invest-consult-currency-toman-v1";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const form = $("#plan-form");
const resultPanel = $("#plan-output");
const marketDataEl = $("#market-data");
const statusEl = $("#live-status");
const historyListEl = $("#history-list");
const historySummaryEl = $("#history-summary");
const portfolioBreakdownEl = $("#portfolio-breakdown");
const historyChartEl = $("#history-chart");
const allocationListEl = $("#allocation-list");
const reasonListEl = $("#reason-list");
const contributionPlanEl = $("#contribution-plan");
const simulationSummaryEl = $("#simulation-summary");
const simulationChartEl = $("#simulation-chart");
const monteCarloEl = $("#monte-carlo-output");
const backtestEl = $("#backtest-output");
const portfolioAllocationEl = $("#portfolio-allocation");
const portfolioLedgerEl = $("#portfolio-ledger");
const portfolioAuditEl = $("#portfolio-audit");
const portfolioDonutEl = $("#portfolio-donut");
const simpleChangePanel = $("#simple-change-panel");
const portfolioTransferStatusEl = $("#portfolio-transfer-status");
const appStore = createAppStore();
const appShell = AppShell(document);
const navigationController = createNavigationController(appShell, appStore);

let copy;
let liveMarket = null;
let lastPlan = null;
let pendingSimpleBalances = null;
let pendingSimpleStock = null;
let dashboardRange = "ALL";
let storageWarning = false;
let planPreviewTimer = null;

const fallbackCopy = {
  status: { loading: "Reading market data", connected: "Live data connected", cached: "Using cached data", unavailable: "Live data unavailable" },
  errors: { salary: "Enter a valid salary." },
};

function text(key, fallback = "") {
  return key.split(".").reduce((value, part) => value && value[part], copy) ?? fallback;
}

function escapeHTML(value) {
  return String(value ?? "")
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
    .replace(/[\u066c\u060c,\s]/g, "")
    .replace(/\u066b/g, ".");
}

function numberFromInput(value) {
  const parsed = Number(normalizeDigits(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function groupedNumber(value) {
  const normalized = normalizeDigits(value);
  const negative = normalized.trim().startsWith("-");
  const unsigned = normalized.replace(/[^0-9.]/g, "");
  if (!unsigned) return negative ? "-" : "";
  const [integerPart = "0", ...fractionParts] = unsigned.split(".");
  const fraction = fractionParts.join("").replace(/[^0-9]/g, "");
  const hasDecimal = unsigned.includes(".");
  const integer = integerPart.replace(/^0+(?=\d)/, "") || "0";
  const formattedInteger = new Intl.NumberFormat("fa-IR", { useGrouping: true, maximumFractionDigits: 0 }).format(Number(integer));
  return `${negative ? "-" : ""}${formattedInteger}${hasDecimal ? `٫${fraction}` : ""}`;
}

function formatNumberInput(event) {
  const input = event.currentTarget;
  const before = input.value.slice(0, input.selectionStart ?? input.value.length);
  const digitsBeforeCaret = normalizeDigits(before).replace(/\D/g, "").length;
  input.value = groupedNumber(input.value);
  let caret = 0;
  let seenDigits = 0;
  while (caret < input.value.length && seenDigits < digitsBeforeCaret) {
    if (/\d/.test(normalizeDigits(input.value[caret]))) seenDigits += 1;
    caret += 1;
  }
  if (typeof input.setSelectionRange === "function") input.setSelectionRange(caret, caret);
}

function formatIRR(value) {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0));
}

function formatPercent(value, digits = 1) {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number(value) || 0) + "\u066a";
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "\u2014";
  return new Intl.DateTimeFormat("fa-IR", { dateStyle: "short" }).format(date);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "\u2014";
  return new Intl.DateTimeFormat("fa-IR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function formatTrackingDuration(start, end = new Date()) {
  const startTime = new Date(start || 0).getTime();
  const endTime = new Date(end || 0).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) return "\u2014";
  const totalMonths = Math.floor((endTime - startTime) / (365.25 * 24 * 60 * 60 * 1000 / 12));
  if (totalMonths < 1) return "کمتر از یک ماه";
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const parts = [];
  if (years) parts.push(`${formatIRR(years)} سال`);
  if (months) parts.push(`${formatIRR(months)} ماه`);
  return parts.join(" و ") || "کمتر از یک ماه";
}

function showStorageWarning() {
  if (!storageWarning) return;
  const error = $("#app-error");
  if (!error) return;
  error.hidden = false;
  error.textContent = "بخشی از داده‌های محلی قابل خواندن یا ذخیره نبود؛ برنامه با حالت امن و بدون حدس‌زدن عددها ادامه داد. اگر این داده‌ها مهم‌اند، فایل پشتیبان قبلی را وارد کن.";
}

function setStatus(label, type = "loading") {
  statusEl.textContent = label;
  statusEl.className = `status-pill status-${type}`;
}

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    storageWarning = true;
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    storageWarning = true;
    showStorageWarning();
    return false;
  }
}

function divideByTen(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number / 10 : value;
}

function isQuantityInToman(assetId) {
  return ["fixed", "stocks", "cash", "other"].includes(assetId) || String(assetId || "").startsWith("custom:");
}

function migrateHistoryCurrency(records) {
  return Array.isArray(records) ? records.map((entry) => {
    const next = { ...entry };
    ["salary", "total"].forEach((key) => {
      if (Number.isFinite(Number(next[key]))) next[key] = divideByTen(next[key]);
    });
    if (next.contributionPlan && typeof next.contributionPlan === "object") {
      next.contributionPlan = Object.fromEntries(Object.entries(next.contributionPlan).map(([key, value]) => [key, divideByTen(value)]));
    }
    if (next.marketSnapshot && typeof next.marketSnapshot === "object") {
      next.marketSnapshot = { ...next.marketSnapshot, assets: Object.fromEntries(Object.entries(next.marketSnapshot.assets || {}).map(([key, item]) => [key, item && Number.isFinite(Number(item.price)) ? { ...item, price: divideByTen(item.price) } : item]) ) };
    }
    return next;
  }) : records;
}

function migratePortfolioCurrency(portfolio) {
  if (!portfolio || typeof portfolio !== "object" || !Array.isArray(portfolio.versions)) return portfolio;
  const next = JSON.parse(JSON.stringify(portfolio));
  next.versions = next.versions.map((version) => ({
    ...version,
    transactions: Array.isArray(version.transactions) ? version.transactions.map((transaction) => {
      const result = { ...transaction };
      if (result.quantity !== undefined && isQuantityInToman(result.assetId)) result.quantity = divideByTen(result.quantity);
      if (result.targetQuantity !== undefined && isQuantityInToman(result.targetAssetId)) result.targetQuantity = divideByTen(result.targetQuantity);
      if (result.amount !== undefined) result.amount = divideByTen(result.amount);
      if (result.fee !== undefined) result.fee = divideByTen(result.fee);
      if (result.unitPrice !== undefined && ["gold", "silver", "currency", "bitcoin", "ethereum", "tether", "platinum", "palladium", "copper"].includes(result.assetId)) result.unitPrice = divideByTen(result.unitPrice);
      if (result.targetUnitPrice !== undefined && ["gold", "silver", "currency", "bitcoin", "ethereum", "tether", "platinum", "palladium", "copper"].includes(result.targetAssetId)) result.targetUnitPrice = divideByTen(result.targetUnitPrice);
      if (result.marketQuote && Number.isFinite(Number(result.marketQuote.price))) result.marketQuote = { ...result.marketQuote, price: divideByTen(result.marketQuote.price) };
      return result;
    }) : [],
  }));
  return next;
}

function migrateMarketCurrency(market) {
  if (!market || typeof market !== "object") return market;
  const next = JSON.parse(JSON.stringify(market));
  if (next.assets && typeof next.assets === "object") {
    Object.values(next.assets).forEach((item) => { if (item && Number.isFinite(Number(item.price))) item.price = divideByTen(item.price); });
  }
  if (next.history && typeof next.history === "object") {
    Object.values(next.history).forEach((series) => {
      if (!Array.isArray(series)) return;
      series.forEach((point) => {
        if (Array.isArray(point) && Number.isFinite(Number(point[1]))) point[1] = divideByTen(point[1]);
        else if (point && typeof point === "object") {
          ["value", "price", "close", "c"].forEach((key) => { if (Number.isFinite(Number(point[key]))) point[key] = divideByTen(point[key]); });
        }
      });
    });
  }
  return next;
}

function migrateStoredCurrencyToToman() {
  if (readJson(CURRENCY_MIGRATION_KEY, false)) return;
  const history = readJson(HISTORY_KEY, null);
  if (Array.isArray(history)) writeJson(HISTORY_KEY, migrateHistoryCurrency(history));
  const legacyHistory = readJson("investment-plan-history-v3", null);
  if (Array.isArray(legacyHistory)) writeJson("investment-plan-history-v3", migrateHistoryCurrency(legacyHistory));
  const portfolio = readJson(PORTFOLIO_KEY, null);
  if (portfolio) writeJson(PORTFOLIO_KEY, migratePortfolioCurrency(portfolio));
  const market = readJson(MARKET_CACHE_KEY, null);
  if (market) writeJson(MARKET_CACHE_KEY, migrateMarketCurrency(market));
  writeJson(CURRENCY_MIGRATION_KEY, true);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = MARKET_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function readHistory() {
  const current = readJson(HISTORY_KEY, []);
  const old = readJson("investment-plan-history-v3", []);
  try {
    if (localStorage.getItem(HISTORY_KEY) !== null && !Array.isArray(current)) storageWarning = true;
    if (localStorage.getItem("investment-plan-history-v3") !== null && !Array.isArray(old)) storageWarning = true;
  } catch {
    storageWarning = true;
  }
  return mergeHistory(current, old, HISTORY_LIMIT);
}

function readPortfolio() {
  const raw = readJson(PORTFOLIO_KEY, null);
  try {
    const exists = localStorage.getItem(PORTFOLIO_KEY) !== null;
    if (exists && (!raw || typeof raw !== "object" || raw.schema !== "invest-consult-portfolio" || !Array.isArray(raw.versions))) storageWarning = true;
  } catch {
    storageWarning = true;
  }
  return normalizePortfolio(raw);
}

function writePortfolio(portfolio) {
  return writeJson(PORTFOLIO_KEY, normalizePortfolio(portfolio));
}

function getProfile() {
  const ageInput = $("#age").value.trim();
  return {
    age: ageInput ? numberFromInput(ageInput) : undefined,
    horizonYears: numberFromInput($("#horizon").value),
    goal: $("#goal").value,
    riskTolerance: $("#risk-tolerance").value,
    incomeStability: $("#income-stability").value,
    emergencyFund: $("#emergency-fund").value,
  };
}

function getPlanInputs() {
  const salary = numberFromInput($("#salary").value);
  const contributionRate = clamp(numberFromInput($("#contribution-rate").value), 5, 40);
  const profile = getProfile();
  const initialInvestment = Math.max(0, numberFromInput($("#initial-investment").value));
  const contributionGrowth = clamp(numberFromInput($("#contribution-growth").value), -50, 200) / 100;
  const inflationRate = clamp(numberFromInput($("#inflation-rate").value), -20, 300) / 100;
  const paths = clamp(numberFromInput($("#simulation-paths").value), 1000, 10000);
  return {
    salary,
    contributionRate,
    monthlyContribution: salary * contributionRate / 100,
    profile,
    initialInvestment,
    contributionGrowth,
    inflationRate,
    paths,
    rebalance: $("#rebalancing").checked,
  };
}

function syncPlanState() {
  const inputs = getPlanInputs();
  appStore.setState({ profile: inputs.profile, monthlyInvestment: inputs.monthlyContribution });
}

function persistProfile() {
  const inputs = getPlanInputs();
  writeJson(PROFILE_KEY, {
    ...inputs.profile,
    salary: inputs.salary,
    contributionRate: inputs.contributionRate,
    initialInvestment: inputs.initialInvestment,
    contributionGrowth: inputs.contributionGrowth * 100,
    inflationRate: inputs.inflationRate * 100,
    paths: inputs.paths,
    rebalance: inputs.rebalance,
  });
}

function restoreProfile() {
  const profile = readJson(PROFILE_KEY, null);
  if (!profile) return;
  ["age", "horizon"].forEach((key) => {
    const source = key === "age" ? profile.age : profile.horizonYears;
    if (source) $("#" + key).value = source;
  });
  ["goal", "riskTolerance", "incomeStability", "emergencyFund"].forEach((key) => {
    const aliases = { riskTolerance: "risk-tolerance", incomeStability: "income-stability", emergencyFund: "emergency-fund" };
    const element = $("#" + (aliases[key] || key));
    if (element && profile[key]) element.value = profile[key];
  });
  if (Number.isFinite(Number(profile.salary)) && Number(profile.salary) > 0) $("#salary").value = profile.salary;
  if (Number.isFinite(Number(profile.contributionRate))) $("#contribution-rate").value = clamp(profile.contributionRate, 5, 40);
  if (Number.isFinite(Number(profile.initialInvestment))) $("#initial-investment").value = Math.max(0, profile.initialInvestment);
  if (Number.isFinite(Number(profile.contributionGrowth))) $("#contribution-growth").value = clamp(profile.contributionGrowth, -50, 200);
  if (Number.isFinite(Number(profile.inflationRate))) $("#inflation-rate").value = clamp(profile.inflationRate, -20, 300);
  if (Number.isFinite(Number(profile.paths))) $("#simulation-paths").value = clamp(profile.paths, 1000, 10000);
  if (typeof profile.rebalance === "boolean") $("#rebalancing").checked = profile.rebalance;
}

function marketSnapshot(market) {
  if (!market) return null;
  const snapshot = { capturedAt: market.updatedAt || new Date().toISOString(), assets: {}, funds: {} };
  Object.entries(market.assets || {}).forEach(([key, item]) => {
    if (item && Number.isFinite(Number(item.price))) snapshot.assets[key] = {
      price: Number(item.price),
      changePct: Number.isFinite(Number(item.changePct)) ? Number(item.changePct) : null,
      unit: item.unit || null,
      sourceCount: Number(item.sourceCount) || 0,
    };
  });
  const fixed = market.funds && market.funds.fixedIncome;
  if (fixed && Number.isFinite(Number(fixed.effectiveAnnualReturn))) snapshot.funds.fixedIncome = { effectiveAnnualReturn: Number(fixed.effectiveAnnualReturn) };
  return Object.keys(snapshot.assets).length || Object.keys(snapshot.funds).length ? snapshot : null;
}

function marketValueUnit(item) {
  if (item?.unit === "point") return "نقطه";
  if (item?.unit === "gram") return `${text("currencyUnit")}/گرم`;
  if (item?.unit === "coin") return `${text("currencyUnit")}/واحد`;
  return text("currencyUnit");
}

function renderMarket(data) {
  if (!data || !data.assets) {
    marketDataEl.innerHTML = `<div class="empty-state">${escapeHTML(text("market.empty", "No market data is available."))}</div>`;
    $("#market-updated").textContent = "—";
    $("#market-coverage").textContent = "—";
    renderMarketDiagnostics(null);
    return;
  }
  const labels = text("market.labels", {});
  const cards = Object.entries(labels).map(([key, label]) => {
    const item = data.assets[key];
    if (!item || !Number.isFinite(Number(item.price))) return `<div class="market-row market-row-unavailable"><div><span class="asset-dot asset-${key === "dollar" ? "currency" : key}"></span><strong>${escapeHTML(label.title)}</strong><small>${escapeHTML(label.detail)}</small></div><div class="market-value"><strong>—</strong><small>داده در دسترس نیست</small></div></div>`;
    const change = Number(item.changePct);
    const changeLabel = Number.isFinite(change) ? `${change > 0 ? "+" : ""}${formatPercent(change)}` : text("market.noChange", "\u2014");
    const changeClass = change > 0.05 ? "positive" : change < -0.05 ? "negative" : "muted";
    const freshness = item.asOf || data.updatedAt;
    return `<div class="market-row"><div><span class="asset-dot asset-${key === "dollar" ? "currency" : key}"></span><strong>${escapeHTML(label.title)}</strong><small>${escapeHTML(label.detail)}</small></div><div class="market-value"><strong>${formatIRR(item.price)} <small>${escapeHTML(marketValueUnit(item))}</small></strong><span class="${changeClass}">${changeLabel}</span><small>${escapeHTML(String(item.sourceCount || 0))} ${escapeHTML(text("market.sources", "source"))} · ${escapeHTML(freshnessLabel(freshness))}</small></div></div>`;
  }).join("");
  const fixed = data.funds && data.funds.fixedIncome;
  const fixedCard = fixed && Number.isFinite(Number(fixed.effectiveAnnualReturn))
    ? `<div class="market-row"><div><span class="asset-dot asset-fixed"></span><strong>${escapeHTML(text("assets.fixed.title"))}</strong><small>${escapeHTML(text("market.fixedDetail"))}</small></div><div class="market-value"><strong>${formatPercent(fixed.effectiveAnnualReturn)}</strong><small>${escapeHTML(text("market.annual"))} · ${escapeHTML(String(fixed.sourceCount || 0))} ${escapeHTML(text("market.sources", "source"))} · ${escapeHTML(freshnessLabel(fixed.asOf || data.updatedAt))}</small></div></div>`
    : `<div class="market-row market-row-unavailable"><div><span class="asset-dot asset-fixed"></span><strong>${escapeHTML(text("assets.fixed.title"))}</strong><small>${escapeHTML(text("market.fixedDetail"))}</small></div><div class="market-value"><strong>—</strong><small>داده در دسترس نیست</small></div></div>`;
  marketDataEl.innerHTML = cards + fixedCard || `<div class="empty-state">${escapeHTML(text("market.empty", "No market data is available."))}</div>`;
  $("#market-updated").textContent = data.updatedAt ? `${text("market.updated", "Updated")} ${formatDateTime(data.updatedAt)}` : "\u2014";
  const sourceTotal = Object.values(data.assets).reduce((total, item) => total + (Number(item.sourceCount) || 0), 0);
  $("#market-coverage").textContent = `${sourceTotal} ${text("market.sourceQuotes", "valid source quotes")}`;
  renderMarketDiagnostics(data);
}

function latestPlanSnapshot() {
  if (lastPlan) return lastPlan;
  const latest = readHistory()[0];
  if (!latest) return null;
  return {
    inputs: {
      monthlyContribution: latest.total,
      contributionRate: latest.contributionRate,
      profile: latest.profile || { riskTolerance: "conservative", horizonYears: 5, emergencyFund: "partial" },
    },
    recommendation: { weights: latest.weights || {} },
    contribution: { amounts: latest.contributionPlan || {} },
    monteCarlo: null,
  };
}

function readDashboardPortfolio() {
  const portfolio = readPortfolio();
  const inflationRate = numberFromInput($("#inflation-rate")?.value) / 100;
  const result = calculatePortfolio(portfolio, liveMarket || {}, new Date().toISOString(), inflationRate);
  return { portfolio, result, hasTransactions: result.transactions.length > 0 };
}

function dashboardCurrency(value) {
  return Number.isFinite(Number(value)) ? `${formatIRR(value)} ${text("currencyUnit")}` : "—";
}

function setDashboardMetric(valueId, noteId, value, note, state = "ready") {
  const valueElement = $(`#${valueId}`);
  const noteElement = $(`#${noteId}`);
  if (valueElement) {
    valueElement.textContent = value;
    valueElement.classList.remove("positive", "negative", "muted");
  }
  if (noteElement) noteElement.textContent = note;
  const card = valueElement?.closest(".summary-card");
  if (card) {
    card.dataset.state = state;
    card.setAttribute("aria-busy", state === "loading" ? "true" : "false");
  }
}

function freshnessLabel(value) {
  const timestamp = new Date(value || 0).getTime();
  if (!Number.isFinite(timestamp)) return "زمان نامشخص";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 2) return "همین الان";
  if (minutes < 60) return `${formatIRR(minutes)} دقیقه قبل`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${formatIRR(hours)} ساعت قبل`;
  return `${formatIRR(Math.round(hours / 24))} روز قبل`;
}

function confidenceLabel(item) {
  const count = Number(item?.sourceCount) || 0;
  if (count >= 3) return { label: "اعتماد بالا", className: "confidence-high" };
  if (count === 2) return { label: "اعتماد متوسط", className: "confidence-medium" };
  if (count === 1) return { label: "یک منبع", className: "confidence-low" };
  return { label: "در دسترس نیست", className: "confidence-none" };
}

function dashboardPerformancePoints(portfolio, result) {
  if (!result.trackingStart || !result.transactions.length) return [];
  const asOf = new Date().toISOString();
  const inflationRate = numberFromInput($("#inflation-rate")?.value) / 100;
  return portfolioSeries(portfolio, liveMarket || {}, result.trackingStart, asOf, inflationRate).map((point) => {
    const state = calculatePortfolio(portfolio, liveMarket || {}, point.date, inflationRate);
    const complete = state.missingPrices.length === 0;
    return {
      date: point.date,
      label: formatDate(point.date),
      value: complete ? state.currentValue : null,
      realValue: complete ? state.realValue : null,
      invested: state.netInvested,
    };
  });
}

function filterDashboardRange(points) {
  if (dashboardRange === "ALL" || !points.length) return points;
  const days = dashboardRange === "1M" ? 31 : dashboardRange === "6M" ? 183 : 365;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const filtered = points.filter((point) => new Date(point.date).getTime() >= cutoff);
  const prior = points.filter((point) => new Date(point.date).getTime() < cutoff).at(-1);
  return prior ? [prior, ...filtered] : filtered;
}

function renderDashboardPerformance() {
  const container = $("#dashboard-performance-chart");
  if (!container) return;
  const { portfolio, result } = readDashboardPortfolio();
  const marketLoading = result.transactions.length > 0 && result.missingPrices.length > 0 && appStore.getState().marketStatus === "loading";
  if (marketLoading) {
    container.innerHTML = `<div class="chart-loading" aria-busy="true">در حال دریافت قیمت‌های لازم برای ارزش‌گذاری…</div>`;
    return;
  }
  const points = filterDashboardRange(dashboardPerformancePoints(portfolio, result));
  container.innerHTML = lineChartMarkup({
    series: [
      { name: "سرمایه خالص", color: "#8997a0", points: points.map((point) => ({ value: point.invested, label: point.label })) },
      { name: "ارزش اسمی", color: "#126b62", points: points.map((point) => ({ value: point.value, label: point.label })) },
      { name: "ارزش پس از تورم", color: "#c18a2c", points: points.map((point) => ({ value: point.realValue, label: point.label })) },
    ],
    ariaLabel: "روند ارزش پرتفوی و سرمایه خالص",
    emptyLabel: result.transactions.length ? "تاریخچه قیمت کافی برای رسم این روند نیست." : "با ثبت دارایی و دریافت قیمت تاریخی، روند اینجا نمایش داده می‌شود.",
    valueLabel: dashboardCurrency,
    height: 280,
  });
}

function renderDashboardAllocation(result, plan, portfolio) {
  const chart = $("#dashboard-allocation-chart");
  const list = $("#dashboard-allocation-list");
  if (!chart || !list) return;
  const marketLoading = result.transactions.length > 0 && result.missingPrices.length > 0 && appStore.getState().marketStatus === "loading";
  if (marketLoading) {
    chart.innerHTML = `<div class="chart-loading" aria-busy="true">در حال دریافت قیمت‌های لازم…</div>`;
    list.innerHTML = `<div class="chart-loading allocation-loading" aria-busy="true">مقایسه فعلی و هدف بعد از به‌روزرسانی قیمت‌ها نمایش داده می‌شود.</div>`;
    return;
  }
  const complete = result.transactions.length > 0 && result.missingPrices.length === 0;
  const availableAssetIds = Object.keys(result.assets || {});
  const actual = availableAssetIds.map((assetId) => ({
    assetId,
    value: complete ? Number(result.values[assetId]?.value) || 0 : 0,
    percent: complete ? Number(result.allocation[assetId]) || 0 : 0,
  })).filter((item) => item.value > 0);
  chart.innerHTML = donutChartMarkup({
    segments: actual.map((item) => ({ name: portfolioAssetMeta(item.assetId, portfolio).title, value: item.value, color: getAssetColor(item.assetId), percentLabel: formatPercent(item.percent) })),
    centerLabel: "ارزش سبد",
    centerValue: complete ? dashboardCurrency(result.currentValue) : "—",
    emptyLabel: result.transactions.length && result.missingPrices.length ? "برای بعضی دارایی‌ها قیمت در دسترس نیست." : "هنوز تخصیصی برای نمایش نیست.",
  });
  const target = plan?.recommendation?.weights || {};
  const rowAssetIds = [...new Set([...ASSET_KEYS, ...actual.map((item) => item.assetId)])];
  const rows = rowAssetIds.filter((assetId) => (actual.some((item) => item.assetId === assetId) || Number(target[assetId]) > 0)).map((assetId) => {
    const actualPercent = Number(result.allocation[assetId]) || 0;
    const targetPercent = Number(target[assetId]);
    const hasTarget = Number.isFinite(targetPercent);
    const delta = hasTarget ? actualPercent - targetPercent : null;
    const warning = hasTarget && Math.abs(delta) >= 10;
    const meta = portfolioAssetMeta(assetId, portfolio);
    return `<div class="allocation-compare-row"><div><span class="asset-dot ${escapeHTML(meta.dotClass)}"></span><strong>${escapeHTML(meta.title)}</strong></div><span>${complete ? formatPercent(actualPercent) : "—"}</span><span>${hasTarget ? formatPercent(targetPercent) : "—"}</span><small class="${warning ? "allocation-warning" : ""}">${hasTarget ? `${delta > 0 ? "+" : ""}${formatPercent(delta)} ${warning ? "· نیازمند توجه" : ""}` : "هدف ثبت نشده"}</small></div>`;
  }).join("");
  list.innerHTML = rows || `<div class="empty-state">با ثبت پرتفوی یا ساخت برنامه، مقایسه نمایش داده می‌شود.</div>`;
}

function renderDashboardHealth(result, plan) {
  const container = $("#dashboard-health-list");
  if (!container) return;
  const transactions = result.transactions || [];
  const months = new Set(transactions.filter((item) => ["OPENING", "BUY", "DEPOSIT"].includes(item.type)).map((item) => String(item.date).slice(0, 7)));
  const consistency = transactions.length ? (months.size >= 3 ? ["خوب", "ثبت واریز در چند ماه مختلف دیده می‌شود.", "health-good"] : ["اطلاعات کم", "برای قضاوت درباره نظم واریز، چند ماه دیگر سابقه لازم است.", "health-neutral"]) : ["در دسترس نیست", "هنوز تراکنشی برای سنجش نظم واریز ثبت نشده.", "health-neutral"];
  const held = Object.values(result.values || {}).filter((item) => Number(item.quantity) > 0 && Number(item.value) > 0);
  const diversification = !held.length ? ["در دسترس نیست", "هنوز دارایی قابل ارزش‌گذاری ثبت نشده.", "health-neutral"] : held.length >= 3 ? ["خوب", `${formatIRR(held.length)} دسته دارایی در سبد ارزش‌گذاری شده است.`, "health-good"] : ["تک‌محور", "تعداد دسته‌های دارایی کم است؛ این هشدار توصیه خرید نیست.", "health-warning"];
  const emergency = plan?.inputs?.profile?.emergencyFund;
  const emergencyState = emergency === "complete" ? ["ثبت‌شده", "صندوق اضطراری کامل اعلام شده است.", "health-good"] : emergency === "none" ? ["نیازمند توجه", "قبل از افزایش نرخ سرمایه‌گذاری، صندوق اضطراری را بررسی کن.", "health-warning"] : emergency === "partial" ? ["نسبی", "صندوق اضطراری کامل اعلام نشده است.", "health-warning"] : ["در دسترس نیست", "این گزینه در پروفایل برنامه ثبت نشده.", "health-neutral"];
  const maxAllocation = Math.max(0, ...held.map((item) => Number(result.allocation[Object.keys(result.values).find((key) => result.values[key] === item)]) || 0));
  const concentration = !held.length ? ["در دسترس نیست", "برای سنجش تمرکز، ارزش‌گذاری کامل لازم است.", "health-neutral"] : maxAllocation > 75 ? ["بالا", `بیشترین وزن تقریبا ${formatPercent(maxAllocation)} است.`, "health-warning"] : maxAllocation > 55 ? ["متوسط", `بیشترین وزن تقریبا ${formatPercent(maxAllocation)} است.`, "health-warning"] : ["قابل قبول", `بیشترین وزن تقریبا ${formatPercent(maxAllocation)} است.`, "health-good"];
  const tracking = !transactions.length ? ["در دسترس نیست", "برای سنجش کامل بودن ردیابی، حداقل یک رویداد و قیمت معتبر لازم است.", "health-neutral"] : result.missingPrices.length ? ["ناقص", `برای ${formatIRR(result.missingPrices.length)} دارایی قیمت معتبر ثبت نشده است.`, "health-warning"] : ["کامل", "همه دارایی‌های دارای موجودی، قیمت قابل استفاده دارند.", "health-good"];
  const items = [["نظم واریز", consistency], ["تنوع دارایی", diversification], ["صندوق اضطراری", emergencyState], ["ریسک تمرکز", concentration], ["کامل بودن ردیابی", tracking]];
  container.innerHTML = items.map(([label, [status, detail, className]]) => `<div class="health-item"><span class="health-dot ${className}"></span><div><strong>${escapeHTML(label)}</strong><small>${escapeHTML(detail)}</small></div><b class="${className}">${escapeHTML(status)}</b></div>`).join("");
}

function getAssetColor(assetId) {
  return { fixed: "#126b62", gold: "#c18a2c", currency: "#4979a7", silver: "#8997a0", stocks: "#8b5bb7", cash: "#4c9c6d", other: "#c56c4a", bitcoin: "#f7931a", ethereum: "#627eea", tether: "#26a17b", platinum: "#8a9aa8", palladium: "#6d7480", copper: "#b87333", bourseIndex: "#7c5cbf" }[assetId] || "#126b62";
}

function renderMarketSnapshot(data) {
  const container = $("#dashboard-market-snapshot");
  const status = $("#dashboard-market-status");
  if (!container || !status) return;
  if (!data || !data.assets) {
    status.textContent = text("dashboard.marketUnavailable", "داده بازار در دسترس نیست؛ عدد ساختگی نمایش داده نمی‌شود.");
    status.className = "data-note data-note-warning";
    container.innerHTML = `<div class="empty-state">داده بازار در دسترس نیست. از صفحه بازار دوباره تلاش کن.</div>`;
    return;
  }
  const sourceTotal = Object.values(data.assets).reduce((total, item) => total + (Number(item?.sourceCount) || 0), 0);
  status.textContent = `${formatIRR(sourceTotal)} quote معتبر · ${freshnessLabel(data.updatedAt)}`;
  status.className = "data-note";
  const marketKeys = ["gold", "dollar", "silver", "bitcoin", "ethereum", "bourseIndex"];
  const items = marketKeys.map((key) => {
    const item = data.assets[key];
    const label = text(`market.labels.${key}.title`, text(`assets.${key}.title`, key));
    return item ? `<article class="market-snapshot-item"><div><span class="asset-dot asset-${key === "dollar" ? "currency" : key}"></span><strong>${escapeHTML(label)}</strong></div><b>${formatIRR(item.price)} ${escapeHTML(marketValueUnit(item))}</b><span class="${Number(item.changePct) > 0.05 ? "positive" : Number(item.changePct) < -0.05 ? "negative" : "muted"}">${Number.isFinite(Number(item.changePct)) ? `${Number(item.changePct) > 0 ? "+" : ""}${formatPercent(item.changePct)}` : "تغییر روزانه نامشخص"}</span><small>${freshnessLabel(item.asOf || data.updatedAt)} · ${escapeHTML(confidenceLabel(item).label)}</small></article>` : `<article class="market-snapshot-item is-unavailable"><strong>${escapeHTML(label)}</strong><b>—</b><small>داده در دسترس نیست</small></article>`;
  });
  const fixed = data.funds?.fixedIncome;
  items.push(fixed ? `<article class="market-snapshot-item"><div><span class="asset-dot asset-fixed"></span><strong>درآمد ثابت</strong></div><b>${formatPercent(fixed.effectiveAnnualReturn)}</b><span class="muted">بازده موثر سالانه</span><small>${freshnessLabel(data.updatedAt)} · ${escapeHTML(confidenceLabel(fixed).label)}</small></article>` : `<article class="market-snapshot-item is-unavailable"><strong>درآمد ثابت</strong><b>—</b><small>داده در دسترس نیست</small></article>`);
  container.innerHTML = items.join("");
}

function renderMarketDiagnostics(data) {
  const container = $("#market-diagnostics");
  if (!container) return;
  if (!data?.diagnostics) {
    container.innerHTML = `<div class="empty-state">تشخیص منبع برای این پاسخ در دسترس نیست.</div>`;
    return;
  }
  const providers = Object.entries(data.diagnostics.providers || {}).map(([id, item]) => `<div class="diagnostic-row"><div><strong>${escapeHTML(id)}</strong><small>${item.status === "fulfilled" ? "پاسخ داده" : "ناموفق"}</small></div><b>${formatIRR(item.quoteCount || 0)} quote</b></div>`).join("");
  const assets = Object.entries(data.diagnostics.assets || {}).map(([id, item]) => `<div class="diagnostic-row"><div><strong>${escapeHTML(id)}</strong><small>${formatIRR(item.successful || 0)} از ${formatIRR(item.attempted || 0)} منبع</small></div><b class="${item.successful ? "positive" : "negative"}">${item.successful ? "قابل استفاده" : "در دسترس نیست"}</b></div>`).join("");
  container.innerHTML = `<div><span class="kicker">منابع</span>${providers || `<div class="empty-state">موردی نیست.</div>`}</div><div><span class="kicker">پوشش دارایی</span>${assets || `<div class="empty-state">موردی نیست.</div>`}</div><div class="diagnostic-method"><span class="kicker">روش تجمیع</span><p>قیمت هر دارایی از میانه quoteهای معتبر منابع پاسخ‌گو ساخته می‌شود؛ منبع ناموفق حذف می‌شود و داده قدیمی یا ساختگی جایگزین نمی‌شود.</p></div>`;
}

function renderDashboard() {
  const onboarding = $("#dashboard-onboarding");
  const summary = $("#dashboard-current-value");
  if (!onboarding || !summary) return;
  const plan = latestPlanSnapshot();
  const { portfolio, result, hasTransactions } = readDashboardPortfolio();
  const complete = hasTransactions && result.missingPrices.length === 0;
  const marketLoading = hasTransactions && result.missingPrices.length > 0 && appStore.getState().marketStatus === "loading";
  const valuationState = !hasTransactions ? "empty" : marketLoading ? "loading" : complete ? "ready" : "unavailable";
  const empty = !plan && !hasTransactions;
  onboarding.classList.toggle("is-hidden", !empty);

  setDashboardMetric("dashboard-current-value", "dashboard-current-value-note", complete ? dashboardCurrency(result.currentValue) : "—", !hasTransactions ? "هنوز دفتر پرتفوی ثبت نشده" : marketLoading ? "در حال دریافت قیمت‌های بازار" : result.missingPrices.length ? "قیمت بعضی دارایی‌ها در دسترس نیست" : `به‌روزشده ${freshnessLabel(liveMarket?.updatedAt)}`, valuationState);
  setDashboardMetric("dashboard-invested", "dashboard-invested-note", hasTransactions ? dashboardCurrency(result.netInvested) : "—", hasTransactions ? `${formatIRR(result.transactions.length)} رویداد در دفتر` : "از دفتر تراکنش‌ها", hasTransactions ? "ready" : "empty");
  const pnlValue = complete ? `${result.profitLoss >= 0 ? "+" : ""}${dashboardCurrency(result.profitLoss)}` : "—";
  setDashboardMetric("dashboard-profit-loss", "dashboard-profit-loss-note", pnlValue, complete ? "ارزش فعلی منهای سرمایه خالص" : marketLoading ? "در حال دریافت قیمت‌های بازار" : "وقتی ارزش‌گذاری کامل باشد", valuationState);
  const pnlEl = $("#dashboard-profit-loss");
  if (complete) pnlEl.classList.add(result.profitLoss >= 0 ? "positive" : "negative");
  const profitLossPercent = complete && result.netInvested > 0 ? result.profitLoss / result.netInvested * 100 : null;
  setDashboardMetric("dashboard-profit-loss-percent", "dashboard-profit-loss-percent-note", profitLossPercent === null ? "—" : `${profitLossPercent >= 0 ? "+" : ""}${formatPercent(profitLossPercent)}`, profitLossPercent === null ? (!hasTransactions ? "نسبت به سرمایه خالص" : marketLoading ? "در حال دریافت قیمت‌های بازار" : "وقتی ارزش‌گذاری کامل و سرمایه خالص مشخص باشد") : "سود یا زیان تقسیم بر سرمایه خالص", profitLossPercent === null ? valuationState : "ready");
  const pnlPercentEl = $("#dashboard-profit-loss-percent");
  if (pnlPercentEl && profitLossPercent !== null) pnlPercentEl.classList.add(profitLossPercent >= 0 ? "positive" : "negative");
  const monthly = Number(plan?.inputs?.monthlyContribution);
  setDashboardMetric("dashboard-monthly-contribution", "dashboard-monthly-contribution-note", Number.isFinite(monthly) ? dashboardCurrency(monthly) : "—", plan ? `${formatPercent(plan.inputs.contributionRate || 0, 0)} از حقوق ماهانه` : "هنوز برنامه‌ای ذخیره نشده", plan ? "ready" : "empty");
  setDashboardMetric("dashboard-tracking-duration", "dashboard-tracking-duration-note", result.trackingStart ? formatTrackingDuration(result.trackingStart) : "—", result.trackingStart ? `از ${formatDate(result.trackingStart)}` : "از شروع دفتر پرتفوی", result.trackingStart ? "ready" : "empty");
  const topAllocation = complete ? Object.keys(result.assets || {}).map((assetId) => ({ id: assetId, value: Number(result.allocation[assetId]) || 0 })).sort((a, b) => b.value - a.value).filter((item) => item.value > 0).slice(0, 2) : [];
  setDashboardMetric("dashboard-allocation-summary", "dashboard-allocation-summary-note", topAllocation.length ? topAllocation.map((item) => `${portfolioAssetMeta(item.id, portfolio).title} ${formatPercent(item.value)}`).join(" · ") : "—", complete ? "از ارزش فعلی دارایی‌ها" : marketLoading ? "در حال دریافت قیمت‌های بازار" : "برای نمایش، موجودی و قیمت لازم است", valuationState);
  renderDashboardPerformance();
  renderDashboardAllocation(result, plan, portfolio);
  renderDashboardHealth(result, plan);
  const actionAmount = $("#dashboard-action-amount");
  const actionSuggestion = $("#dashboard-action-suggestion");
  const actionAllocation = $("#dashboard-action-allocation");
  const actionReason = $("#dashboard-action-reason");
  if (plan) {
    actionAmount.textContent = dashboardCurrency(monthly);
    actionSuggestion.textContent = "این مبلغ را طبق وزن‌های برنامه و بدون خرید اجباری بین دسته‌ها پخش کن.";
    const amounts = plan.contribution?.amounts || {};
    const allocationItems = Object.entries(amounts).filter(([, amount]) => Number(amount) > 0).sort((left, right) => Number(right[1]) - Number(left[1])).slice(0, 3);
    if (actionAllocation) actionAllocation.innerHTML = allocationItems.map(([assetId, amount]) => `<span><i class="asset-dot ${escapeHTML(assetMeta(assetId).dotClass)}"></i>${escapeHTML(assetMeta(assetId).title)} ${formatIRR(amount)} ${escapeHTML(text("currencyUnit"))}</span>`).join("");
    actionReason.textContent = plan.inputs.profile?.emergencyFund === "none" ? "صندوق اضطراری کامل نیست؛ نرخ و مبلغ را قبل از ثبت نهایی بازبینی کن." : "پیشنهاد از هدف، افق و تحمل ریسک ثبت‌شده ساخته شده است.";
  } else {
    actionAmount.textContent = "—";
    actionSuggestion.textContent = "برای دیدن مبلغ و تخصیص پیشنهادی، برنامه ماهانه بساز.";
    if (actionAllocation) actionAllocation.innerHTML = "";
    actionReason.textContent = "بدون ورودی کافی، عددی حدس زده نمی‌شود.";
  }
  renderMarketSnapshot(liveMarket);
}

function assetMeta(key) {
  return text(`assets.${key}`, { title: key, description: "", dotClass: `asset-${key}` });
}

function portfolioAssetMeta(assetId, portfolio = null) {
  const custom = portfolio && portfolio.assets && portfolio.assets[assetId];
  if (custom) return { title: custom.kind === "legacy-stock" ? "سهام ثبت‌شده قدیمی" : custom.title, description: "دارایی سهامی ثبت‌شده توسط تو", dotClass: "asset-stocks", unit: custom.unit };
  return assetMeta(assetId);
}

function portfolioUnitLabel(assetId, unit) {
  if (unit === "gram") return "گرم";
  if (unit === "TOMAN" || unit === "IRR") return text("currencyUnit");
  return text(`portfolio.units.${assetId}`, unit || text("currencyUnit"));
}

function allocationRows(allocation, amounts = null) {
  return ASSET_KEYS.map((key) => {
    const meta = assetMeta(key);
    const weight = Number(allocation[key]) || 0;
    const amount = amounts ? amounts[key] : 0;
    return `<div class="allocation-row"><div class="allocation-name"><span class="asset-dot ${escapeHTML(meta.dotClass)}"></span><div><strong>${escapeHTML(meta.title)}</strong><small>${escapeHTML(meta.description)}</small></div></div><div class="allocation-numbers"><strong>${formatPercent(weight)}</strong><small>${formatIRR(amount)} ${escapeHTML(text("currencyUnit"))}</small></div></div>`;
  }).join("");
}

function renderReasons(profile, historyPortfolio) {
  const reasons = [];
  if (profile.emergencyFund === "none") reasons.push(text("reasons.emergency"));
  if (profile.horizonYears <= 3) reasons.push(text("reasons.shortHorizon"));
  if (profile.horizonYears >= 10) reasons.push(text("reasons.longHorizon"));
  if (profile.riskTolerance === "conservative") reasons.push(text("reasons.conservative"));
  if (historyPortfolio.totalInvested > 0) reasons.push(text("reasons.history"));
  reasons.push(text("reasons.noForecast"));
  reasonListEl.innerHTML = reasons.filter(Boolean).slice(0, 4).map((reason) => `<li>${escapeHTML(reason)}</li>`).join("");
}

function renderContributionPlan(plan) {
  contributionPlanEl.innerHTML = ASSET_KEYS.map((key) => {
    const meta = assetMeta(key);
    return `<div class="contribution-row"><span><span class="asset-dot ${escapeHTML(meta.dotClass)}"></span>${escapeHTML(meta.title)}</span><strong>${formatIRR(plan.amounts[key])} ${escapeHTML(text("currencyUnit"))}</strong></div>`;
  }).join("");
}

function renderLineChart(container, points, valueKey = "nominal", label = "") {
  if (!container) return;
  container.innerHTML = lineChartMarkup({
    series: [{
      name: label,
      color: "#126b62",
      points: (Array.isArray(points) ? points : []).map((point) => ({
        value: point && point[valueKey],
        label: point?.date ? formatDate(point.date) : "",
      })),
    }],
    ariaLabel: label || text("analysis.chart", "روند ارزش"),
    emptyLabel: text("analysis.chartEmpty", "داده کافی برای رسم نمودار وجود ندارد."),
    valueLabel: (value) => `${formatIRR(value)} ${text("currencyUnit")}`,
  });
}

function formatPortfolioQuantity(assetId, quantity) {
  if (["gold", "silver", "platinum", "palladium", "copper"].includes(assetId)) return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 3 }).format(Number(quantity) || 0);
  if (["bitcoin", "ethereum", "tether"].includes(assetId)) return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 8 }).format(Number(quantity) || 0);
  return formatIRR(quantity);
}

function portfolioValueLabel(value) {
  return value === null || value === undefined ? text("portfolio.unavailable", "Unavailable") : `${formatIRR(value)} ${text("currencyUnit")}`;
}

function renderPortfolioChart(series, portfolio, inflationRate) {
  const chart = $("#portfolio-chart");
  if (!series.length || series.length < 2) {
    chart.innerHTML = `<div class="empty-state">${escapeHTML(series.length ? "برای رسم روند حداقل دو نقطه زمانی لازم است." : text("portfolio.empty"))}</div>`;
    return;
  }
  const points = series.map((point) => {
    const state = calculatePortfolio(portfolio, liveMarket || {}, point.date, inflationRate);
    return {
      date: point.date,
      label: formatDate(point.date),
      invested: state.netInvested,
      value: point.value,
      realValue: point.realValue,
    };
  });
  chart.innerHTML = lineChartMarkup({
    series: [
      { name: "سرمایه خالص", color: "#8997a0", points: points.map((point) => ({ value: point.invested, label: point.label })) },
      { name: "ارزش اسمی", color: "#126b62", points: points.map((point) => ({ value: point.value, label: point.label })) },
      { name: "ارزش پس از تورم", color: "#c18a2c", points: points.map((point) => ({ value: point.realValue, label: point.label })) },
    ],
    ariaLabel: text("portfolio.chart"),
    emptyLabel: text("portfolio.missingPrices"),
    valueLabel: portfolioValueLabel,
    height: 260,
  });
}

function readSimpleBalances() {
  return Object.fromEntries(SIMPLE_ASSET_IDS.map((assetId) => [assetId, Math.max(0, numberFromInput($("#portfolio-" + assetId).value))]));
}

function populateSimpleBalances(holdings) {
  SIMPLE_ASSET_IDS.forEach((assetId) => {
    const input = $("#portfolio-" + assetId);
    if (input && document.activeElement !== input) input.value = holdings[assetId] > 0 ? holdings[assetId] : "";
  });
}

function setPortfolioStatus(message, type = "neutral") {
  if (!portfolioTransferStatusEl) return;
  portfolioTransferStatusEl.textContent = message;
  portfolioTransferStatusEl.className = `transfer-status transfer-${type}`;
}

function populatePortfolioAssetOptions() {
  const portfolio = readPortfolio();
  const options = assetIds(portfolio).map((assetId) => {
    const meta = portfolioAssetMeta(assetId, portfolio);
    return `<option value="${escapeHTML(assetId)}">${escapeHTML(meta.title)}</option>`;
  }).join("");
  [$("#advanced-asset"), $("#advanced-target-asset")].forEach((select) => {
    if (!select) return;
    const current = select.value;
    select.innerHTML = options;
    if (assetIds(portfolio).includes(current)) select.value = current;
  });
  const marketSelect = $("#portfolio-market-asset");
  if (marketSelect) {
    const supported = ["gold", "silver", "currency", "bitcoin", "ethereum", "tether", "platinum", "palladium", "copper"];
    const current = marketSelect.value;
    marketSelect.innerHTML = supported.map((assetId) => {
      const meta = portfolioAssetMeta(assetId, portfolio);
      return `<option value="${escapeHTML(assetId)}">${escapeHTML(meta.title)}</option>`;
    }).join("");
    if (supported.includes(current)) marketSelect.value = current;
    const selected = portfolioAssetMeta(marketSelect.value, portfolio);
    const unit = $("#portfolio-market-asset-unit");
    if (unit) unit.textContent = portfolioUnitLabel(marketSelect.value, portfolio.assets?.[marketSelect.value]?.unit || (marketSelect.value === "currency" ? "TOMAN" : ""));
  }
}

function renderPortfolio() {
  if (!portfolioAllocationEl) return;
  populatePortfolioAssetOptions();
  const portfolio = readPortfolio();
  const asOf = new Date().toISOString();
  const inflationRate = numberFromInput($("#inflation-rate").value) / 100;
  const result = calculatePortfolio(portfolio, liveMarket || {}, asOf, inflationRate);
  appStore.setState({ portfolio: result });
  const version = activePortfolioVersion(portfolio);
  const hasTransactions = result.transactions.length > 0;
  const completeValuation = hasTransactions && result.missingPrices.length === 0;
  $("#portfolio-current-value").textContent = completeValuation ? portfolioValueLabel(result.currentValue) : hasTransactions ? text("portfolio.unavailable", "در دسترس نیست") : "—";
  $("#portfolio-net-invested").textContent = portfolioValueLabel(result.netInvested);
  $("#portfolio-profit-loss").textContent = completeValuation ? portfolioValueLabel(result.profitLoss) : text("portfolio.unavailable", "در دسترس نیست");
  $("#portfolio-profit-loss").className = completeValuation ? (result.profitLoss >= 0 ? "positive" : "negative") : "muted";
  $("#portfolio-cagr").textContent = !completeValuation || result.cagr === null ? text("portfolio.unavailable") : formatPercent(result.cagr * 100);
  $("#portfolio-real-return").textContent = !completeValuation || result.inflationAdjustedReturn === null ? text("portfolio.unavailable") : formatPercent(result.inflationAdjustedReturn * 100);
  $("#portfolio-start-date").textContent = result.trackingStart ? formatDate(result.trackingStart) : text("portfolio.notStarted");
  const versionLabel = version.label === "Initial portfolio" ? text("portfolio.initialLabel") : version.label;
  $("#portfolio-version-label").textContent = versionLabel;
  $("#portfolio-version-count").textContent = `${portfolio.versions.length} ${text("portfolio.versionCount")}`;
  $("#portfolio-audit-count").textContent = `${version.audit.length} ${text("portfolio.auditCount")}`;

  const heldAssetIds = assetIds(portfolio).filter((assetId) => Math.abs(result.values[assetId].quantity) > 1e-7);
  const allocationRows = heldAssetIds.map((assetId) => {
    const meta = portfolioAssetMeta(assetId, portfolio);
    const item = result.values[assetId];
    return `<button type="button" class="allocation-row allocation-row-button" data-portfolio-asset="${escapeHTML(assetId)}"><span class="allocation-name"><span class="asset-dot ${escapeHTML(meta.dotClass)}"></span><span><strong>${escapeHTML(meta.title)}</strong><small>${escapeHTML(formatPortfolioQuantity(assetId, item.quantity))} ${escapeHTML(portfolioUnitLabel(assetId, item.unit))}</small></span></span><span class="allocation-numbers"><strong>${item.value === null ? escapeHTML(text("portfolio.unavailable")) : formatPercent(result.allocation[assetId])}</strong><small>${escapeHTML(portfolioValueLabel(item.value))}</small></span></button>`;
  }).join("");
  portfolioAllocationEl.innerHTML = allocationRows || `<div class="empty-state">${escapeHTML(text("portfolio.empty"))}</div>`;
  if (portfolioDonutEl) {
    portfolioDonutEl.innerHTML = donutChartMarkup({
      segments: heldAssetIds.map((assetId) => ({ name: portfolioAssetMeta(assetId, portfolio).title, value: Number(result.values[assetId].value) || 0, color: getAssetColor(assetId), percentLabel: formatPercent(result.allocation[assetId] || 0) })),
      centerLabel: "ارزش فعلی",
      centerValue: result.missingPrices.length ? "—" : portfolioValueLabel(result.currentValue),
      emptyLabel: result.missingPrices.length ? text("portfolio.missingPrices") : text("portfolio.empty"),
    });
  }

  const quality = $("#portfolio-data-quality");
  if (!hasTransactions) quality.textContent = text("portfolio.empty");
  else if (result.missingPrices.length) quality.textContent = `${text("portfolio.missingPrices")} ${result.missingPrices.map((assetId) => portfolioAssetMeta(assetId, portfolio).title).join(", ")}`;
  else quality.textContent = text("portfolio.complete");
  quality.className = `data-note ${result.missingPrices.length ? "data-note-warning" : ""}`;

  populateSimpleBalances(result.holdings);
  const series = result.trackingStart ? portfolioSeries(portfolio, liveMarket || {}, result.trackingStart, asOf, inflationRate) : [];
  renderPortfolioChart(series, portfolio, inflationRate);
  if (hasTransactions && result.trackingStart && new Date(result.trackingStart).toDateString() === new Date(asOf).toDateString()) {
    $("#portfolio-chart-note").textContent = text("portfolio.startsToday");
  } else {
    $("#portfolio-chart-note").textContent = text("portfolio.chartNote");
  }

  portfolioLedgerEl.innerHTML = hasTransactions ? result.transactions.slice().reverse().slice(0, 20).map((transaction) => {
    const type = text(`portfolio.transactionTypes.${transaction.type}`, transaction.type);
    const meta = portfolioAssetMeta(transaction.assetId, portfolio);
    const quantity = transaction.quantity === undefined ? transaction.amount : transaction.quantity;
    const unit = transaction.quantity === undefined ? text("currencyUnit") : portfolioUnitLabel(transaction.assetId, meta.unit);
    const target = transaction.type === "TRANSFER" ? ` ${text("portfolio.to")} ${escapeHTML(portfolioAssetMeta(transaction.targetAssetId, portfolio).title)}` : "";
    return `<div class="ledger-row"><div><strong>${escapeHTML(type)}</strong><small>${escapeHTML(formatDate(transaction.date))} ${escapeHTML(text("history.separator"))} ${escapeHTML(meta.title)}${target}</small></div><div><strong>${escapeHTML(formatPortfolioQuantity(transaction.assetId, quantity))}</strong><small>${escapeHTML(unit)}</small></div></div>`;
  }).join("") : `<div class="empty-state">${escapeHTML(text("portfolio.noLedger"))}</div>`;

  portfolioAuditEl.innerHTML = version.audit.length ? version.audit.slice().reverse().slice(0, 12).map((event) => `<div class="audit-row"><div><strong>${escapeHTML(text(`portfolio.auditActions.${event.action}`, event.action))}</strong><small>${escapeHTML(formatDateTime(event.timestamp))}</small></div><span class="audit-${event.affectsHistory ? "history" : "normal"}">${escapeHTML(event.affectsHistory ? text("portfolio.auditHistory") : text("portfolio.auditNormal"))}</span></div>`).join("") : `<div class="empty-state">${escapeHTML(text("portfolio.noAudit"))}</div>`;
  renderStockList(portfolio, result);
  renderDashboard();
}

function renderStockList(portfolio, result) {
  const stockList = $("#portfolio-stock-list");
  if (!stockList) return;
  const stocks = Object.entries(portfolio.assets || {}).filter(([, asset]) => asset.kind === "stock" || asset.kind === "legacy-stock");
  stockList.innerHTML = stocks.length ? stocks.map(([assetId, asset]) => {
    const item = result.values[assetId];
    const value = item && Number.isFinite(item.value) ? portfolioValueLabel(item.value) : text("portfolio.unavailable");
    return `<div class="stock-row"><div><strong>${escapeHTML(asset.title)}</strong><small>${escapeHTML(text("portfolio.stockAccount"))}</small></div><div><strong>${escapeHTML(value)}</strong><small>${escapeHTML(text("portfolio.editByReenter"))}</small></div></div>`;
  }).join("") : `<div class="empty-state">${escapeHTML(text("portfolio.noStocks"))}</div>`;
}

function openAssetDrawer(assetId) {
  const drawer = $("#asset-detail-drawer");
  const content = $("#asset-drawer-content");
  const title = $("#asset-drawer-title");
  if (!drawer || !content || !title) return;
  const portfolio = readPortfolio();
  const result = calculatePortfolio(portfolio, liveMarket || {}, new Date().toISOString(), numberFromInput($("#inflation-rate")?.value) / 100);
  const item = result.values[assetId];
  if (!item) return;
  const meta = portfolioAssetMeta(assetId, portfolio);
  title.textContent = meta.title;
  const transactions = result.transactions.filter((transaction) => transaction.assetId === assetId || transaction.targetAssetId === assetId).length;
  const price = item.price === null ? "—" : portfolioValueLabel(item.price);
  content.innerHTML = `<div class="asset-detail-summary"><div><span>مقدار</span><strong>${escapeHTML(formatPortfolioQuantity(assetId, item.quantity))} ${escapeHTML(portfolioUnitLabel(assetId, item.unit))}</strong></div><div><span>قیمت مبنا/بازار</span><strong>${escapeHTML(price)}</strong></div><div><span>ارزش فعلی</span><strong>${escapeHTML(portfolioValueLabel(item.value))}</strong></div><div><span>سهم از سبد</span><strong>${item.value === null ? "—" : escapeHTML(formatPercent(result.allocation[assetId] || 0))}</strong></div></div><div class="data-note ${item.value === null ? "data-note-warning" : ""}">${item.value === null ? "برای این دارایی قیمت معتبر در داده بازار وجود ندارد؛ ارزش ریالی را حدس نمی‌زنیم." : `در دفتر فعال ${formatIRR(transactions)} رویداد مرتبط ثبت شده است.`}</div><button type="button" class="secondary-button" data-go-view="portfolio">ویرایش موجودی و تراکنش‌ها</button>`;
  if (typeof drawer.showModal === "function") drawer.showModal();
  else drawer.setAttribute("open", "");
}

function renderSimulation(simulation, monteCarlo) {
  simulationSummaryEl.innerHTML = [
    [text("analysis.invested"), `${formatIRR(simulation.totalInvested)} ${text("currencyUnit")}`],
    [text("analysis.final"), `${formatIRR(simulation.finalValue)} ${text("currencyUnit")}`],
    [text("analysis.realFinal"), `${formatIRR(simulation.finalRealValue)} ${text("currencyUnit")}`],
    [text("analysis.drawdown"), formatPercent(simulation.maxDrawdown * 100)],
  ].map(([label, value]) => `<div class="metric"><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong></div>`).join("");
  renderLineChart(simulationChartEl, simulation.points.filter((point, index) => index % Math.max(1, Math.floor(simulation.points.length / 18)) === 0 || index === simulation.points.length - 1), "nominal", text("analysis.path"));
  monteCarloEl.innerHTML = [
    [text("analysis.p10"), monteCarlo.nominal.p10],
    [text("analysis.p50"), monteCarlo.nominal.p50],
    [text("analysis.p90"), monteCarlo.nominal.p90],
  ].map(([label, value]) => `<div class="range-metric"><span>${escapeHTML(label)}</span><strong>${formatIRR(value)} ${escapeHTML(text("currencyUnit"))}</strong><small>${escapeHTML(text("analysis.nominal"))}</small></div>`).join("") + `<p class="data-quality">${escapeHTML(monteCarlo.estimated ? text("analysis.estimated") : text("analysis.observed"))} ${escapeHTML(text("analysis.observations"))}: ${escapeHTML(String(monteCarlo.historicalObservations || 0))}</p>`;
  const p10 = Number(monteCarlo.nominal.p10);
  const p90 = Number(monteCarlo.nominal.p90);
  $("#monthly-range").textContent = Number.isFinite(p10) && Number.isFinite(p90) ? `${formatIRR(p10)} تا ${formatIRR(p90)}` : "—";
  const scenarioEl = $("#scenario-comparison");
  if (scenarioEl) {
    const scenarios = [["محتاطانه", monteCarlo.nominal.p10, "نتیجه صدک ۱۰ مدل", "scenario-cautious"], ["میانه", monteCarlo.nominal.p50, "نتیجه صدک ۵۰ مدل", "scenario-base"], ["خوش‌بینانه", monteCarlo.nominal.p90, "نتیجه صدک ۹۰ مدل", "scenario-positive"]];
    scenarioEl.innerHTML = scenarios.map(([name, value, detail, className]) => `<div class="scenario-card ${className}"><span>${escapeHTML(name)}</span><strong>${formatIRR(value)} ${escapeHTML(text("currencyUnit"))}</strong><small>${escapeHTML(detail)}</small></div>`).join("");
  }
}

function renderBacktest(result) {
  if (!result || !result.available) {
    backtestEl.innerHTML = `<div class="empty-state">${escapeHTML(text("backtest.insufficient"))}</div>`;
    return;
  }
  const metric = (label, value, percent = false) => `<div class="metric"><small>${escapeHTML(label)}</small><strong>${percent ? formatPercent(value * 100) : formatIRR(value) + " " + text("currencyUnit")}</strong></div>`;
  backtestEl.innerHTML = `<div class="backtest-note">${escapeHTML(result.estimated ? text("backtest.partial") : text("backtest.full"))} ${escapeHTML(text("backtest.observations"))}: ${escapeHTML(String(result.observations))}</div><div class="metric-grid">${metric(text("backtest.medianFinal"), result.median.finalValue)}${metric(text("backtest.medianCagr"), result.median.cagr, true)}${metric(text("backtest.medianReal"), result.median.inflationAdjustedReturn, true)}${metric(text("backtest.medianDrawdown"), result.median.maxDrawdown, true)}</div><div class="best-worst"><div><small>${escapeHTML(text("backtest.best"))}</small><strong>${escapeHTML(result.best.start)} ${escapeHTML(text("to"))} ${escapeHTML(result.best.end)}</strong><span>${formatPercent(result.best.cagr * 100)}</span></div><div><small>${escapeHTML(text("backtest.worst"))}</small><strong>${escapeHTML(result.worst.start)} ${escapeHTML(text("to"))} ${escapeHTML(result.worst.end)}</strong><span>${formatPercent(result.worst.cagr * 100)}</span></div></div>`;
}

function renderHistory() {
  const history = readHistory();
  appStore.setState({ history });
  const portfolio = portfolioFromHistory(history, liveMarket);
  const categories = ASSET_KEYS.map((key) => {
    const meta = assetMeta(key);
    const category = portfolio.categories[key];
    const gain = category.value - category.invested;
    return `<div class="portfolio-row"><div><span class="asset-dot ${escapeHTML(meta.dotClass)}"></span><strong>${escapeHTML(meta.title)}</strong></div><div><strong>${formatIRR(category.value)} ${escapeHTML(text("currencyUnit"))}</strong><small>${escapeHTML(text("history.current"))}</small></div><div class="${gain >= 0 ? "positive" : "negative"}"><strong>${gain >= 0 ? "+" : ""}${formatIRR(gain)}</strong><small>${escapeHTML(text("history.gain"))}</small></div></div>`;
  }).join("");
  historySummaryEl.innerHTML = [
    [text("history.invested"), formatIRR(portfolio.totalInvested)],
    [text("history.value"), formatIRR(portfolio.currentValue)],
    [text("history.gain"), `${portfolio.gain >= 0 ? "+" : ""}${formatIRR(portfolio.gain)}`],
    [text("history.records"), String(history.length)],
  ].map(([label, value]) => `<div class="metric"><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong></div>`).join("");
  portfolioBreakdownEl.innerHTML = portfolio.totalInvested ? categories : `<div class="empty-state">${escapeHTML(text("history.emptyBreakdown"))}</div>`;
  const chronological = history.slice().reverse();
  const chartPoints = chronological.map((entry, index) => ({ nominal: portfolioFromHistory(chronological.slice(0, index + 1), liveMarket).currentValue }));
  renderLineChart(historyChartEl, chartPoints, "nominal", text("history.chart"));
  historyListEl.innerHTML = history.length ? history.slice(0, 15).map((entry) => `<div class="history-item"><div><strong>${formatDate(entry.createdAt)}</strong><small>${formatPercent(entry.contributionRate)} ${escapeHTML(text("history.separator"))} ${escapeHTML(text("history.monthly"))}</small></div><div><strong>${formatIRR(entry.total)} ${escapeHTML(text("currencyUnit"))}</strong><small>${escapeHTML(text("history.saved"))}</small></div></div>`).join("") : `<div class="empty-state">${escapeHTML(text("history.empty"))}</div>`;
  renderHistoricalComparison();
}

function marketHistoryPoints(assetKey) {
  const raw = liveMarket?.history?.[assetKey];
  if (!Array.isArray(raw)) return [];
  return raw.map((point) => {
    const date = Array.isArray(point) ? point[0] : point?.date || point?.time || point?.timestamp;
    const value = Array.isArray(point) ? point[1] : point?.price ?? point?.value ?? point?.close ?? point?.c;
    return { date, value: Number(value), label: date ? formatDate(date) : "" };
  }).filter((point) => Number.isFinite(new Date(point.date).getTime()) && Number.isFinite(point.value) && point.value > 0).sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
}

function mixedMarketSeries(keys, weights) {
  const maps = keys.map((key) => new Map(marketHistoryPoints(key).map((point) => [new Date(point.date).toISOString().slice(0, 10), point.value])));
  if (maps.some((map) => !map.size)) return [];
  const dates = [...maps[0].keys()].filter((date) => maps.every((map) => map.has(date))).sort();
  return dates.map((date) => ({ date, label: formatDate(date), value: keys.reduce((sum, key, index) => sum + maps[index].get(date) * weights[index], 0) }));
}

function renderHistoricalComparison() {
  const chart = $("#historical-comparison-chart");
  const list = $("#historical-comparison-list");
  if (!chart || !list) return;
  const series = [];
  const { portfolio, result } = readDashboardPortfolio();
  const userPoints = result.trackingStart ? portfolioSeries(portfolio, liveMarket || {}, result.trackingStart, new Date().toISOString(), numberFromInput($("#inflation-rate")?.value) / 100).filter((point) => Number.isFinite(point.value)).map((point) => ({ date: point.date, value: point.value, label: formatDate(point.date) })) : [];
  if (userPoints.length >= 2) series.push({ name: "پرتفوی تو", color: "#126b62", points: normalizeSeriesIndex(userPoints) });
  const benchmarkDefinitions = [
    ["gold", "طلا", "#c18a2c"],
    ["dollar", "ارز", "#4979a7"],
    ["silver", "نقره", "#8997a0"],
  ];
  const availability = [];
  benchmarkDefinitions.forEach(([key, name, color]) => {
    const points = marketHistoryPoints(key);
    availability.push({ name, available: points.length >= 2, detail: points.length >= 2 ? `${formatIRR(points.length)} مشاهده تاریخی` : "تاریخچه کافی در دسترس نیست" });
    if (points.length >= 2) series.push({ name, color, points: normalizeSeriesIndex(points) });
  });
  const mixed = mixedMarketSeries(["gold", "dollar", "silver"], [0.4, 0.3, 0.3]);
  availability.push({ name: "سبد ساده بازار", available: mixed.length >= 2, detail: mixed.length >= 2 ? "۴۰٪ طلا · ۳۰٪ ارز · ۳۰٪ نقره" : "به سه تاریخچه مشترک نیاز دارد" });
  if (mixed.length >= 2) series.push({ name: "سبد ساده بازار", color: "#8b5bb7", points: normalizeSeriesIndex(mixed) });
  availability.push({ name: "درآمد ثابت", available: false, detail: "داده تاریخی صندوق در API فعلی وجود ندارد" });
  chart.innerHTML = lineChartMarkup({
    series,
    ariaLabel: "مقایسه شاخصی پرتفوی و دارایی‌های بازار",
    emptyLabel: "برای مقایسه، تاریخچه بازار یا دفتر پرتفوی کافی وجود ندارد.",
    valueLabel: (value) => `${formatIRR(value)} شاخص`,
    height: 280,
  });
  list.innerHTML = availability.map((item) => `<div class="benchmark-item"><span class="health-dot ${item.available ? "health-good" : "health-neutral"}"></span><div><strong>${escapeHTML(item.name)}</strong><small>${escapeHTML(item.detail)}</small></div><b>${item.available ? "قابل مقایسه" : "در دسترس نیست"}</b></div>`).join("");
}

function calculatePlan(inputs) {
  const recommendation = recommendAllocation(inputs.profile);
  const history = readHistory();
  const portfolio = portfolioFromHistory(history, liveMarket);
  const currentHoldings = Object.fromEntries(ASSET_KEYS.map((key) => [key, portfolio.categories[key].value]));
  const contribution = contributionRebalance(currentHoldings, recommendation.weights, inputs.monthlyContribution);
  const modelResult = estimateReturnModel(liveMarket || {}, DEFAULT_ASSUMPTIONS);
  const simulation = simulatePlan({ ...inputs, allocation: recommendation.weights, annualReturns: modelResult.model });
  const monteCarlo = runMonteCarlo({ ...inputs, allocation: recommendation.weights, returnModel: modelResult.model, historical: modelResult.historical });
  return { inputs, recommendation, contribution, simulation, monteCarlo, portfolio, modelResult };
}

function renderPlanOutput(plan) {
  const { inputs, recommendation, contribution, simulation, monteCarlo, portfolio } = plan;
  $("#monthly-investment").textContent = formatIRR(inputs.monthlyContribution);
  $("#monthly-rate").textContent = formatPercent(inputs.contributionRate);
  $("#profile-label").textContent = text(`profileLabels.${inputs.profile.riskTolerance}`, text("profileLabels.conservative"));
  allocationListEl.innerHTML = allocationRows(recommendation.weights, contribution.amounts);
  renderContributionPlan(contribution);
  renderReasons(inputs.profile, portfolio);
  renderSimulation(simulation, monteCarlo);
}

function renderPlan({ saveHistoryRecord = true, scrollIntoView = true, validate = true } = {}) {
  const inputs = getPlanInputs();
  if (!(inputs.salary > 0)) {
    if (validate) {
      $("#salary").focus();
      $("#salary").setCustomValidity(text("errors.salary", fallbackCopy.errors.salary));
      $("#salary").reportValidity();
    }
    return false;
  }
  $("#salary").setCustomValidity("");
  persistProfile();
  lastPlan = calculatePlan(inputs);
  renderPlanOutput(lastPlan);
  appStore.setState({ profile: inputs.profile, monthlyInvestment: inputs.monthlyContribution, plan: lastPlan });
  resultPanel.classList.remove("is-hidden");
  const previewStatus = $("#plan-preview-status");
  if (previewStatus) {
    previewStatus.textContent = saveHistoryRecord ? "این برنامه در تاریخچه همین دستگاه ذخیره شد." : "پیش‌نمایش زنده است؛ برای ثبت این نسخه در تاریخچه، برنامه را بساز.";
    previewStatus.className = `transfer-status ${saveHistoryRecord ? "transfer-success" : "transfer-neutral"}`;
  }
  if (saveHistoryRecord) {
    saveHistory(inputs, lastPlan.recommendation, lastPlan.contribution);
    renderHistory();
  }
  renderDashboard();
  if (scrollIntoView) resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

function saveHistory(inputs, recommendation, contribution) {
  const history = readHistory();
  const entry = {
    createdAt: new Date().toISOString(),
    salary: inputs.salary,
    contributionRate: inputs.contributionRate,
    total: inputs.monthlyContribution,
    weights: recommendation.weights,
    contributionPlan: contribution.amounts,
    profile: inputs.profile,
    marketSnapshot: marketSnapshot(liveMarket),
  };
  writeJson(HISTORY_KEY, mergeHistory([entry], history, HISTORY_LIMIT));
}

function handleMarketAssetSubmit(event) {
  event.preventDefault();
  const assetId = $("#portfolio-market-asset").value;
  const quantity = Math.max(0, numberFromInput($("#portfolio-market-quantity").value));
  if (!assetId || !(quantity > 0)) {
    setPortfolioStatus("دارایی و مقدار معتبر وارد کن.", "warning");
    return;
  }
  const now = new Date().toISOString();
  const portfolio = readPortfolio();
  const type = activePortfolioVersion(portfolio).transactions.length ? "BUY" : "OPENING";
  const transaction = createTransaction({
    type,
    assetId,
    quantity,
    source: "market-asset-entry",
    note: "Market asset entry",
    date: now,
  }, liveMarket || {}, now, portfolio);
  if (!transaction) {
    setPortfolioStatus("قیمت معتبر این دارایی در داده بازار موجود نیست؛ مقدار را دستی در تراکنش پیشرفته ثبت کن.", "warning");
    return;
  }
  const appended = appendTransactions(portfolio, [transaction], { action: type === "OPENING" ? "create-market-asset-opening" : "record-market-asset-purchase", affectsHistory: true, detail: assetId });
  if (!appended.validation.valid || !writePortfolio(appended.portfolio)) {
    setPortfolioStatus(text("portfolio.validation"), "warning");
    return;
  }
  event.target.reset();
  renderPortfolio();
  $("#portfolio-section").open = true;
  setPortfolioStatus("دارایی بازار ثبت شد؛ مقدار و قیمت منبع در دفتر تراکنش نگه داشته شد.", "success");
}

function handleStockEntrySubmit(event) {
  event.preventDefault();
  const title = $("#portfolio-stock-name").value.trim();
  const value = Math.max(0, numberFromInput($("#portfolio-stock-value").value));
  if (!title || !(value > 0)) {
    setPortfolioStatus(text("portfolio.invalidStock"), "warning");
    return;
  }
  const now = new Date().toISOString();
  const portfolio = readPortfolio();
  const existing = Object.values(portfolio.assets || {}).find((asset) => asset.title.toLocaleLowerCase() === title.toLocaleLowerCase());
  if (existing) {
    pendingSimpleStock = { assetId: existing.id, desired: value };
    simpleChangePanel.classList.remove("is-hidden");
    simpleChangePanel.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const created = createPortfolioAsset(portfolio, { title, kind: "stock", unit: "TOMAN" }, now);
  if (!created.asset) {
    setPortfolioStatus(text("portfolio.invalidStock"), "warning");
    return;
  }
  const transaction = createTransaction({ type: "OPENING", assetId: created.asset.id, quantity: value, unitPrice: 1, source: "simple-stock-opening", note: "Simple named stock opening balance", date: now }, liveMarket || {}, now, created.portfolio);
  const appended = appendTransactions(created.portfolio, [transaction], { action: "create-stock-account", affectsHistory: true, detail: title });
  if (!appended.validation.valid || !writePortfolio(appended.portfolio)) {
    setPortfolioStatus(text("portfolio.validation"), "warning");
    return;
  }
  event.target.reset();
  renderPortfolio();
  $("#portfolio-section").open = true;
  setPortfolioStatus(text("portfolio.stockSaved"), "success");
}

function handleSimplePortfolioSubmit(event) {
  event.preventDefault();
  const desired = readSimpleBalances();
  const portfolio = readPortfolio();
  const current = calculatePortfolio(portfolio, liveMarket || {}, new Date().toISOString());
  if (!current.transactions.length && !SIMPLE_ASSET_IDS.some((assetId) => desired[assetId] > 0)) {
    setPortfolioStatus(text("portfolio.invalid"), "warning");
    return;
  }
  if (!current.transactions.length) {
    const now = new Date().toISOString();
    const transactions = SIMPLE_ASSET_IDS.map((assetId) => desired[assetId] > 0 ? createTransaction({ type: "OPENING", assetId, quantity: desired[assetId], source: "simple-opening", note: "Simple opening balance" }, liveMarket || {}, now) : null).filter(Boolean);
    if (transactions.length !== SIMPLE_ASSET_IDS.filter((assetId) => desired[assetId] > 0).length) {
      setPortfolioStatus(text("portfolio.marketUnavailable"), "warning");
      return;
    }
    const appended = appendTransactions(portfolio, transactions, { action: "create-opening-balance", affectsHistory: true, detail: "Simple opening balance" });
    if (!appended.validation.valid || !writePortfolio(appended.portfolio)) {
      setPortfolioStatus(text("portfolio.validation"), "warning");
      return;
    }
    renderPortfolio();
    $("#portfolio-section").open = true;
    setPortfolioStatus(text("portfolio.saved"), "success");
    return;
  }
  pendingSimpleBalances = desired;
  simpleChangePanel.classList.remove("is-hidden");
  simpleChangePanel.scrollIntoView({ behavior: "smooth", block: "center" });
}

function applySimpleChange() {
  if (pendingSimpleStock) {
    applySimpleStockChange();
    return;
  }
  if (!pendingSimpleBalances) return;
  const reason = $("#simple-change-reason").value;
  const now = new Date().toISOString();
  const portfolio = readPortfolio();
  const current = calculatePortfolio(portfolio, liveMarket || {}, now);
  const affectsHistory = reason !== "new-purchase";
  if (affectsHistory && !window.confirm(text("portfolio.confirmHistoryChange"))) return;

  if (reason === "restart-tracking") {
    const restartHoldings = { ...current.holdings, ...pendingSimpleBalances };
    const openingTransactions = assetIds(portfolio).map((assetId) => {
      const quantity = Math.max(0, Number(restartHoldings[assetId]) || 0);
      if (quantity <= 0) return null;
      const unitPrice = portfolio.assets && portfolio.assets[assetId] ? 1 : undefined;
      return createTransaction({ type: "OPENING", assetId, quantity, unitPrice, source: "simple-restart", note: "Restart tracking baseline" }, liveMarket || {}, now, portfolio);
    }).filter(Boolean);
    const expectedOpeningCount = assetIds(portfolio).filter((assetId) => Math.max(0, Number(restartHoldings[assetId]) || 0) > 0).length;
    if (openingTransactions.length !== expectedOpeningCount) {
      setPortfolioStatus(text("portfolio.marketUnavailable"), "warning");
      return;
    }
    const versioned = createPortfolioVersion(portfolio, openingTransactions, text("portfolio.newVersionLabel"), now);
    if (!versioned.validation.valid || !writePortfolio(versioned.portfolio)) {
      setPortfolioStatus(text("portfolio.validation"), "warning");
      return;
    }
  } else {
    const transactions = simpleChangeTransactions(current.holdings, pendingSimpleBalances, reason, liveMarket || {}, now, current.trackingStart);
    if (!transactions.length && reason !== "correction") {
      setPortfolioStatus(text("portfolio.noChange"), "neutral");
      return;
    }
    const appended = appendTransactions(portfolio, transactions, { action: reason === "correction" ? "correct-simple-balance" : "record-simple-purchase", affectsHistory, detail: reason });
    if (!appended.validation.valid || !writePortfolio(appended.portfolio)) {
      setPortfolioStatus(text("portfolio.validation"), "warning");
      return;
    }
  }
  pendingSimpleBalances = null;
  simpleChangePanel.classList.add("is-hidden");
  renderPortfolio();
  $("#portfolio-section").open = true;
  setPortfolioStatus(reason === "correction" ? text("portfolio.corrected") : text("portfolio.updated"), "success");
}

function cancelSimpleChange() {
  pendingSimpleBalances = null;
  pendingSimpleStock = null;
  simpleChangePanel.classList.add("is-hidden");
  setPortfolioStatus(text("portfolio.cancelled"), "neutral");
}

function applySimpleStockChange() {
  const pending = pendingSimpleStock;
  if (!pending) return;
  const reason = $("#simple-change-reason").value;
  const now = new Date().toISOString();
  const portfolio = readPortfolio();
  const current = calculatePortfolio(portfolio, liveMarket || {}, now);
  const currentValue = Number(current.holdings[pending.assetId]) || 0;
  const desired = Math.max(0, Number(pending.desired) || 0);
  const affectsHistory = reason !== "new-purchase";
  if (affectsHistory && !window.confirm(text("portfolio.confirmHistoryChange"))) return;
  let nextPortfolio = portfolio;
  let transactions = [];
  if (reason === "restart-tracking") {
    const holdings = { ...current.holdings, [pending.assetId]: desired };
    const openingTransactions = assetIds(portfolio).map((assetId) => {
      const quantity = Math.max(0, Number(holdings[assetId]) || 0);
      return quantity > 0 ? createTransaction({ type: "OPENING", assetId, quantity, unitPrice: portfolio.assets && portfolio.assets[assetId] ? 1 : undefined, date: now, source: "simple-stock-restart", note: "Restart tracking baseline" }, liveMarket || {}, now, portfolio) : null;
    }).filter(Boolean);
    const versioned = createPortfolioVersion(portfolio, openingTransactions, text("portfolio.newVersionLabel"), now);
    if (!versioned.validation.valid || !writePortfolio(versioned.portfolio)) {
      setPortfolioStatus(text("portfolio.validation"), "warning");
      return;
    }
    nextPortfolio = versioned.portfolio;
  } else {
    const delta = desired - currentValue;
    if (Math.abs(delta) <= 1e-7) {
      setPortfolioStatus(text("portfolio.noChange"), "neutral");
      return;
    }
    const date = reason === "new-purchase" ? now : current.trackingStart || now;
    transactions = [createTransaction({ type: reason === "new-purchase" ? (delta > 0 ? "BUY" : "SELL") : "ADJUSTMENT", assetId: pending.assetId, quantity: Math.abs(delta), unitPrice: 1, date, source: reason === "new-purchase" ? "simple-stock" : "simple-stock-correction", note: "Named stock balance update" }, liveMarket || {}, now, portfolio)].filter(Boolean);
    const appended = appendTransactions(portfolio, transactions, { action: reason === "correction" ? "correct-stock-balance" : "record-stock-purchase", affectsHistory, detail: pending.assetId });
    if (!appended.validation.valid || !writePortfolio(appended.portfolio)) {
      setPortfolioStatus(text("portfolio.validation"), "warning");
      return;
    }
    nextPortfolio = appended.portfolio;
  }
  pendingSimpleStock = null;
  simpleChangePanel.classList.add("is-hidden");
  renderPortfolio();
  setPortfolioStatus(reason === "correction" ? text("portfolio.corrected") : text("portfolio.updated"), "success");
  if (nextPortfolio) $("#portfolio-section").open = true;
}

function updateAdvancedTransactionFields() {
  const type = $("#advanced-type").value;
  const transfer = type === "TRANSFER";
  const cashFlow = ["DEPOSIT", "WITHDRAWAL"].includes(type);
  const quantityType = ["OPENING", "BUY", "SELL", "ADJUSTMENT", "TRANSFER"].includes(type);
  $("#advanced-quantity-label").textContent = quantityType ? text("portfolio.quantity") : text("portfolio.amount");
  $("#advanced-quantity").disabled = !quantityType;
  $("#advanced-amount").disabled = quantityType && type !== "TRANSFER";
  $("#advanced-asset").disabled = cashFlow;
  if (cashFlow) $("#advanced-asset").value = "cash";
  $("#advanced-target-asset").closest(".field").classList.toggle("is-hidden", !transfer);
  $("#advanced-target-quantity").closest(".field").classList.toggle("is-hidden", !transfer);
  $("#advanced-unit-price").closest(".field").classList.toggle("is-hidden", !quantityType || type === "TRANSFER");
}

function handleAdvancedTransactionSubmit(event) {
  event.preventDefault();
  const type = $("#advanced-type").value;
  const date = $("#advanced-date").value || new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const dateTimestamp = new Date(date).getTime();
  const input = {
    type,
    assetId: ["DEPOSIT", "WITHDRAWAL"].includes(type) ? "cash" : $("#advanced-asset").value,
    targetAssetId: $("#advanced-target-asset").value,
    date,
    quantity: ["OPENING", "BUY", "SELL", "ADJUSTMENT", "TRANSFER"].includes(type) ? numberFromInput($("#advanced-quantity").value) : undefined,
    targetQuantity: numberFromInput($("#advanced-target-quantity").value),
    unitPrice: numberFromInput($("#advanced-unit-price").value) || undefined,
    amount: ["DIVIDEND", "DEPOSIT", "WITHDRAWAL"].includes(type) ? numberFromInput($("#advanced-amount").value) : undefined,
    fee: numberFromInput($("#advanced-fee").value),
    note: $("#advanced-note").value,
  };
  const transaction = createTransaction(input, liveMarket || {}, now, readPortfolio());
  if (!transaction) {
    setPortfolioStatus(text("portfolio.validation"), "warning");
    return;
  }
  const affectsHistory = type === "ADJUSTMENT" || dateTimestamp < new Date(now.slice(0, 10)).getTime();
  if (affectsHistory && !window.confirm(text("portfolio.confirmHistoryChange"))) return;
  const appended = appendTransactions(readPortfolio(), [transaction], { action: "add-advanced-transaction", affectsHistory, detail: type });
  if (!appended.validation.valid || !writePortfolio(appended.portfolio)) {
    setPortfolioStatus(text("portfolio.validation"), "warning");
    return;
  }
  event.target.reset();
  $("#advanced-date").value = new Date().toISOString().slice(0, 10);
  updateAdvancedTransactionFields();
  renderPortfolio();
  setPortfolioStatus(text("portfolio.advancedSaved"), "success");
}

function setTransferStatus(message, type = "neutral") {
  [$("#history-transfer-status"), $("#settings-transfer-status")].filter(Boolean).forEach((element) => {
    element.textContent = message;
    element.className = `transfer-status transfer-${type}`;
  });
}

function previewPlanIfVisible() {
  if (resultPanel?.classList.contains("is-hidden")) return;
  if (numberFromInput($("#salary")?.value) <= 0) {
    window.clearTimeout(planPreviewTimer);
    resultPanel.classList.add("is-hidden");
    lastPlan = null;
    appStore.setState({ plan: null, monthlyInvestment: 0 });
    const previewStatus = $("#plan-preview-status");
    if (previewStatus) {
      previewStatus.textContent = "برای نمایش پیش‌نمایش، حقوق ماهانه معتبر را وارد کن.";
      previewStatus.className = "transfer-status transfer-warning";
    }
    return;
  }
  window.clearTimeout(planPreviewTimer);
  planPreviewTimer = window.setTimeout(() => {
    renderPlan({ saveHistoryRecord: false, scrollIntoView: false, validate: false });
  }, 180);
}

function renderSettingsAssumptions() {
  const container = $("#settings-assumptions");
  if (!container) return;
  const inputs = getPlanInputs();
  const values = [
    ["تورم سالانه", `${formatPercent(inputs.inflationRate * 100, 0)}`],
    ["رشد سالانه واریز", `${formatPercent(inputs.contributionGrowth * 100, 0)}`],
    ["تعداد مسیر مونت‌کارلو", formatIRR(inputs.paths)],
  ];
  container.innerHTML = values.map(([label, value]) => `<div><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div>`).join("");
}

function clearAllLocalData() {
  [HISTORY_KEY, "investment-plan-history-v3", PORTFOLIO_KEY, PROFILE_KEY, MARKET_CACHE_KEY, CURRENCY_MIGRATION_KEY].forEach((key) => localStorage.removeItem(key));
  lastPlan = null;
  window.clearTimeout(planPreviewTimer);
  liveMarket = null;
  storageWarning = false;
  pendingSimpleBalances = null;
  pendingSimpleStock = null;
  simpleChangePanel.classList.add("is-hidden");
  appStore.setState({ market: null, history: [], portfolio: null, plan: null, monthlyInvestment: 0, error: null });
  form.reset();
  $("#contribution-output").textContent = formatPercent(Number($("#contribution-rate").value), 0);
  renderSettingsAssumptions();
  renderHistory();
  renderPortfolio();
  renderDashboard();
  renderMarket(null);
  setTransferStatus("داده‌های محلی حذف شد.", "success");
}

function exportHistory() {
  const records = readHistory();
  const portfolio = readPortfolio();
  const hasPortfolio = activePortfolioVersion(portfolio).transactions.length > 0;
  if (!records.length && !hasPortfolio) {
    setTransferStatus(text("history.transfer.empty"), "warning");
    return;
  }
  const payload = JSON.stringify(createHistoryExport(records, portfolio), null, 2);
  const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `invest-consult-history-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  const portfolioLabel = hasPortfolio ? ` ${text("history.separator")} ${text("portfolio.exported")}` : "";
  setTransferStatus(`${text("history.transfer.exported")} ${records.length}${portfolioLabel}`, "success");
}

async function importHistoryFile(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    setTransferStatus(text("history.transfer.tooLarge"), "warning");
    return;
  }
  try {
    const parsed = parseHistoryExport(JSON.parse(await file.text()));
    const importedRecords = parsed.currencyUnit === "TOMAN" ? parsed.records : migrateHistoryCurrency(parsed.records);
    const current = readHistory();
    const merged = mergeHistory(current, importedRecords, HISTORY_LIMIT);
    if (!writeJson(HISTORY_KEY, merged)) throw new Error("storage-failed");
    let portfolioRestored = false;
    let portfolioSkipped = false;
    if (parsed.portfolio) {
      const importedPortfolio = parsed.currencyUnit === "TOMAN" ? parsed.portfolio : migratePortfolioCurrency(parsed.portfolio);
      const currentPortfolio = readPortfolio();
      const currentHasPortfolio = activePortfolioVersion(currentPortfolio).transactions.length > 0;
      if (!currentHasPortfolio || window.confirm(text("portfolio.importConfirm"))) {
        if (!writePortfolio(importedPortfolio)) throw new Error("storage-failed");
        portfolioRestored = true;
      } else {
        portfolioSkipped = true;
      }
    }
    renderHistory();
    renderPortfolio();
    const skipped = parsed.skipped ? ` ${text("history.separator")} ${text("history.transfer.skipped")} ${parsed.skipped}` : "";
    const portfolioStatus = portfolioRestored ? ` ${text("history.separator")} ${text("portfolio.imported")}` : portfolioSkipped ? ` ${text("history.separator")} ${text("portfolio.importSkipped")}` : "";
    setTransferStatus(`${text("history.transfer.imported")} ${merged.length}${skipped}${portfolioStatus}`, "success");
  } catch (error) {
    const key = error && error.message === "storage-failed" ? "history.transfer.storageFailed" : "history.transfer.invalid";
    setTransferStatus(text(key), "warning");
  }
}

function runBacktest() {
  if (!lastPlan) {
    navigationController.goTo("plan");
    renderPlan();
  }
  if (!lastPlan) return;
  const result = backtestHistorical({
    market: liveMarket || {},
    allocation: lastPlan.recommendation.weights,
    initialInvestment: lastPlan.inputs.initialInvestment,
    monthlyContribution: lastPlan.inputs.monthlyContribution,
    contributionGrowth: lastPlan.inputs.contributionGrowth,
    inflationRate: lastPlan.inputs.inflationRate,
    horizonYears: lastPlan.inputs.profile.horizonYears,
    rebalance: lastPlan.inputs.rebalance,
  });
  renderBacktest(result);
  $("#backtest-section").open = true;
  $("#backtest-section").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadMarket() {
  setStatus(text("status.loading", fallbackCopy.status.loading), "loading");
  appStore.setState({ marketStatus: "loading", error: null });
  try {
    const response = await fetchWithTimeout("/api/market", { cache: "default" });
    if (!response.ok) throw new Error("Market request failed");
    liveMarket = await response.json();
    if (!appStore.getState().marketCacheDisabled) writeJson(MARKET_CACHE_KEY, liveMarket);
    appStore.setState({ market: liveMarket, marketStatus: "connected" });
    renderMarket(liveMarket);
    renderHistory();
    renderPortfolio();
    renderDashboard();
    setStatus(text("status.connected", fallbackCopy.status.connected), "success");
  } catch {
    liveMarket = appStore.getState().marketCacheDisabled ? null : readJson(MARKET_CACHE_KEY, null);
    appStore.setState({ market: liveMarket, marketStatus: liveMarket ? "cached" : "unavailable" });
    renderMarket(liveMarket);
    renderHistory();
    renderPortfolio();
    renderDashboard();
    setStatus(liveMarket ? text("status.cached", fallbackCopy.status.cached) : text("status.timeout", fallbackCopy.status.unavailable), "warning");
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
  form.addEventListener("submit", (event) => { event.preventDefault(); renderPlan(); });
  $$('[data-go-view]').forEach((button) => button.addEventListener("click", () => navigationController.goTo(button.dataset.goView)));
  $$('[data-dashboard-range]').forEach((button) => button.addEventListener("click", () => {
    dashboardRange = button.dataset.dashboardRange || "ALL";
    $$('[data-dashboard-range]').forEach((item) => item.classList.toggle("is-active", item === button));
    renderDashboardPerformance();
  }));
  $("#refresh-market").addEventListener("click", loadMarket);
  $("#run-backtest").addEventListener("click", runBacktest);
  $("#export-history").addEventListener("click", exportHistory);
  $("#import-history").addEventListener("click", () => $("#history-file").click());
  $("#history-file").addEventListener("change", importHistoryFile);
  $("#simple-portfolio-form").addEventListener("submit", handleSimplePortfolioSubmit);
  $("#stock-entry-form").addEventListener("submit", handleStockEntrySubmit);
  $("#portfolio-market-asset-form")?.addEventListener("submit", handleMarketAssetSubmit);
  $("#portfolio-market-asset")?.addEventListener("change", () => populatePortfolioAssetOptions());
  $("#apply-simple-change").addEventListener("click", applySimpleChange);
  $("#cancel-simple-change").addEventListener("click", cancelSimpleChange);
  $("#advanced-transaction-form").addEventListener("submit", handleAdvancedTransactionSubmit);
  $("#advanced-type").addEventListener("change", updateAdvancedTransactionFields);
  const clearSavedHistory = () => {
    if (!window.confirm(text("history.transfer.clearConfirm", "Clear saved plans? This does not change the portfolio ledger."))) return;
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem("investment-plan-history-v3");
    renderHistory();
    setTransferStatus(text("history.transfer.cleared"), "neutral");
    navigationController.goTo("history");
  };
  $("#clear-history").addEventListener("click", clearSavedHistory);
  $("#settings-sidebar-collapsed").addEventListener("change", (event) => {
    appStore.setState({ sidebarCollapsed: event.currentTarget.checked });
  });
  $("#settings-market-cache").addEventListener("change", (event) => {
    const disabled = event.currentTarget.checked;
    appStore.setState({ marketCacheDisabled: disabled });
    if (disabled) localStorage.removeItem(MARKET_CACHE_KEY);
    setStatus(disabled ? "ذخیره بازار خاموش است" : text("status.connected", fallbackCopy.status.connected), disabled ? "warning" : "success");
  });
  $("#settings-clear-market-cache").addEventListener("click", () => {
    localStorage.removeItem(MARKET_CACHE_KEY);
    setTransferStatus("داده بازار ذخیره‌شده حذف شد.", "success");
  });
  $("#settings-export-data").addEventListener("click", exportHistory);
  $("#settings-import-data").addEventListener("click", () => $("#settings-file").click());
  $("#settings-file").addEventListener("change", importHistoryFile);
  $("#settings-reset-all").addEventListener("click", () => {
    if (window.confirm("همه برنامه‌ها، دفتر پرتفوی، پروفایل و داده بازار از این مرورگر حذف شود؟ این کار قابل بازگشت نیست.")) clearAllLocalData();
  });
  $("#asset-drawer-close")?.addEventListener("click", () => $("#asset-detail-drawer")?.close());
  $("#portfolio-allocation")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-portfolio-asset]");
    if (button) openAssetDrawer(button.dataset.portfolioAsset);
  });
  appStore.subscribe((state) => {
    const toggle = $("#settings-sidebar-collapsed");
    if (toggle) toggle.checked = state.sidebarCollapsed;
    const cacheToggle = $("#settings-market-cache");
    if (cacheToggle) cacheToggle.checked = state.marketCacheDisabled;
  });
  $("#contribution-rate").addEventListener("input", (event) => { $("#contribution-output").textContent = formatPercent(Number(event.target.value), 0); });
  $$('[data-number-input]').forEach((input) => {
    input.value = groupedNumber(input.value);
    input.addEventListener("input", formatNumberInput);
  });
  $$("#plan-form select, #plan-form input").forEach((element) => {
    element.addEventListener("change", () => { persistProfile(); syncPlanState(); renderSettingsAssumptions(); previewPlanIfVisible(); renderDashboard(); });
    element.addEventListener("input", () => { persistProfile(); syncPlanState(); renderSettingsAssumptions(); previewPlanIfVisible(); renderDashboard(); });
  });
  window.addEventListener("error", () => {
    const error = $("#app-error");
    if (error) { error.hidden = false; error.textContent = "بخشی از رابط کاربری با خطا روبه‌رو شد؛ داده‌های ذخیره‌شده دست‌نخورده باقی مانده‌اند."; }
    appStore.setState({ error: "runtime" });
  });
  window.addEventListener("unhandledrejection", () => {
    const error = $("#app-error");
    if (error) { error.hidden = false; error.textContent = "دریافت داده کامل نشد؛ دوباره تلاش کن."; }
    appStore.setState({ error: "async" });
  });
}

async function init() {
  await loadCopy();
  migrateStoredCurrencyToToman();
  restoreProfile();
  $("#contribution-output").textContent = formatPercent(Number($("#contribution-rate").value), 0);
  bindEvents();
  renderHistory();
  renderPortfolio();
  renderDashboard();
  renderSettingsAssumptions();
  $("#advanced-date").value = new Date().toISOString().slice(0, 10);
  updateAdvancedTransactionFields();
  await loadMarket();
  showStorageWarning();
}

init();
