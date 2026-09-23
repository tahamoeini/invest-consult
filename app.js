// @ts-check

import {
  ASSET_KEYS,
  clamp,
  contributionRebalance,
  portfolioFromHistory,
  recommendAllocation,
} from "./src/engine.js";
import {
  createHistoryExport,
  mergeHistory,
  parseHistoryExport,
} from "./src/history.js";
import {
  PORTFOLIO_ASSETS,
  SIMPLE_ASSET_IDS,
  activePortfolioVersion,
  appendTransactions,
  assetIds,
  calculatePortfolio,
  createPortfolioAsset,
  createPortfolioVersion,
  createTransaction,
  marketPriceAt,
  normalizePortfolio,
  portfolioSeries,
  simpleChangeTransactions,
} from "./src/portfolio.js";
import { INSTRUMENT_REGISTRY } from "./src/market/catalog.js";
import { prepareComparableHistory } from "./src/market/history.js";
import { lastKnownMarketQuote } from "./src/market/last-known.js";
import { AppShell } from "./src/ui/components.js";
import { clampTooltipCenter, donutChartMarkup, lineChartMarkup } from "./src/ui/charts.js";
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
let lastKnownMarket = null;
let lastPlan = null;
let pendingSimpleBalances = null;
let pendingSimpleStock = null;
let dashboardRange = "ALL";
let historyComparisonRange = "1y";
let historyComparisonData = null;
let historyComparisonLoading = false;
let historyComparisonError = null;
let historyComparisonRequestId = 0;
let historyComparisonLoadedSignature = "";
let historyComparisonPendingSignature = "";
const historyComparisonSelection = new Set(["portfolio", "gold", "dollar", "silver"]);
const HISTORY_CHART_COLORS = Object.freeze({
  portfolio: "#126b62",
  dollar: "#4979a7",
  gold: "#c18a2c",
  silver: "#8997a0",
  bitcoin: "#d98232",
  ethereum: "#6d65b7",
  tether: "#278b78",
  platinum: "#5a7485",
  palladium: "#85617f",
  copper: "#ba6949",
  bourseIndex: "#348c84",
});
let storageWarning = false;
let planPreviewTimer = null;
let analysisWorkerTask = null;
let analysisRequestId = 0;
let analyzedPlan = null;
let legacyEmergencyFund = "partial";
let preferredAnalysisMethod = "gaussian";

const fallbackCopy = {
  status: { loading: "در حال خواندن داده بازار", connected: "داده زنده وصل است", cached: "در حال استفاده از داده ذخیره‌شده", unavailable: "داده زنده در دسترس نیست" },
  errors: { salary: "یک حقوق معتبر وارد کن." },
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

function emergencyFundSnapshot(expenses = numberFromInput($("#essential-monthly-expenses")?.value)) {
  if (!(expenses > 0)) return { months: null, status: legacyEmergencyFund };
  const portfolio = calculatePortfolio(readPortfolio(), liveMarket || {});
  const months = portfolio.liquidTotal / expenses;
  return { months, status: months >= 6 ? "complete" : months >= 1 ? "partial" : "none" };
}

function getProfile() {
  const ageInput = $("#age").value.trim();
  const essentialMonthlyExpenses = Math.max(0, numberFromInput($("#essential-monthly-expenses")?.value));
  const emergency = emergencyFundSnapshot(essentialMonthlyExpenses);
  return {
    age: ageInput ? numberFromInput(ageInput) : undefined,
    horizonYears: numberFromInput($("#horizon").value),
    goal: $("#goal").value,
    riskTolerance: $("#risk-tolerance").value,
    incomeStability: $("#income-stability").value,
    emergencyFund: emergency.status,
    emergencyCoverageMonths: emergency.months,
    essentialMonthlyExpenses,
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
  legacyEmergencyFund = ["complete", "partial", "none"].includes(profile.emergencyFund) ? profile.emergencyFund : "partial";
  ["goal", "riskTolerance", "incomeStability"].forEach((key) => {
    const aliases = { riskTolerance: "risk-tolerance", incomeStability: "income-stability", emergencyFund: "emergency-fund" };
    const element = $("#" + (aliases[key] || key));
    if (element && profile[key]) element.value = profile[key];
  });
  if (Number.isFinite(Number(profile.salary)) && Number(profile.salary) > 0) $("#salary").value = profile.salary;
  if (Number.isFinite(Number(profile.essentialMonthlyExpenses))) $("#essential-monthly-expenses").value = Math.max(0, profile.essentialMonthlyExpenses);
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
    if (item && item.price !== null && Number.isFinite(Number(item.price))) snapshot.assets[key] = {
      price: Number(item.price),
      changePct: item.changePct !== null && item.changePct !== undefined && item.changePct !== "" && Number.isFinite(Number(item.changePct)) ? Number(item.changePct) : null,
      unit: item.unit || null,
      sourceCount: Number(item.sourceCount) || 0,
      configuredSourceCount: Number(item.configuredSourceCount) || 0,
      spreadPct: item.spreadPct !== null && item.spreadPct !== undefined && Number.isFinite(Number(item.spreadPct)) ? Number(item.spreadPct) : null,
      sources: Array.isArray(item.sources) ? item.sources.slice(0, 8) : [],
      sourceValues: Array.isArray(item.sourceValues) ? item.sourceValues.slice(0, 8) : [],
      sleeveId: item.sleeveId || null,
      observedAt: item.observedAt || item.asOf || null,
      retrievedAt: item.retrievedAt || market.updatedAt || null,
      quoteType: item.quoteType || "direct",
      derivedFrom: Array.isArray(item.derivedFrom) ? item.derivedFrom.slice(0, 5) : [],
      dependencies: Array.isArray(item.dependencies) ? item.dependencies.slice(0, 5) : [],
      status: item.status || "healthy",
      confidence: item.confidence || null,
      consensusPolicyVersion: item.consensusPolicyVersion || null,
      consensusCalibrated: item.consensusCalibrated === true,
      agreementTolerancePct: item.agreementTolerancePct !== null && item.agreementTolerancePct !== undefined && Number.isFinite(Number(item.agreementTolerancePct)) ? Number(item.agreementTolerancePct) : null,
    };
  });
  const fixed = market.funds && market.funds.fixedIncome;
  if (fixed && fixed.effectiveAnnualReturn !== null && fixed.effectiveAnnualReturn !== undefined && Number.isFinite(Number(fixed.effectiveAnnualReturn))) snapshot.funds.fixedIncome = {
    effectiveAnnualReturn: Number(fixed.effectiveAnnualReturn),
    observedAt: fixed.observedAt || fixed.asOf || null,
    retrievedAt: fixed.retrievedAt || market.updatedAt || null,
    sourceCount: Number(fixed.sourceCount) || 0,
    sources: Array.isArray(fixed.sources) ? fixed.sources.slice(0, 8) : [],
  };
  return Object.keys(snapshot.assets).length || Object.keys(snapshot.funds).length ? snapshot : null;
}

function marketValueUnit(item) {
  if (item?.unit === "point") return "نقطه";
  if (item?.unit === "gram") return `${text("currencyUnit")}/گرم`;
  if (item?.unit === "coin") return `${text("currencyUnit")}/واحد`;
  return text("currencyUnit");
}

function marketUnavailableMessage(item, diagnostics) {
  if (item?.status === "conflicted" || diagnostics?.status === "conflicted") return text("market.conflicted");
  if (diagnostics?.reason === "currency_conflicted") return text("market.currencyConflict");
  if (diagnostics?.reason === "currency_unavailable") return text("market.currencyUnavailable");
  return text("market.unavailable");
}

function lastKnownPriceMarkup(assetId, data, cachedMarket, currentItem) {
  const quote = lastKnownMarketQuote(assetId, data, cachedMarket);
  if (!quote) return "";
  const unit = marketValueUnit({ unit: quote.unit || currentItem?.unit || INSTRUMENT_REGISTRY[assetId]?.unit });
  return `<small class="market-last-known"><strong>${escapeHTML(text("market.lastKnown", "آخرین مقدار ثبت‌شده"))}:</strong> ${formatIRR(quote.price)} ${escapeHTML(unit)} · ${escapeHTML(text("market.lastKnownObserved", "مشاهده"))} ${escapeHTML(formatDateTime(quote.observedAt))} · ${escapeHTML(freshnessLabel(quote.observedAt))}</small>`;
}

function marketConflictSourcesMarkup(item) {
  if (item?.status !== "conflicted" || !Array.isArray(item.sourceValues) || !item.sourceValues.length) return "";
  const unit = marketValueUnit(item);
  const values = item.sourceValues.map((source) => {
    const observed = source.observedAt ? formatDateTime(source.observedAt) : "زمان مشاهده نامشخص";
    return `<div class="market-conflict-source"><strong>${escapeHTML(source.source || "منبع بازار")}</strong><b>${formatIRR(source.price)} ${escapeHTML(unit)}</b><small>زمان مشاهده: ${escapeHTML(observed)}</small></div>`;
  }).join("");
  return `<div class="market-conflict-values" aria-label="مقادیر منابع متعارض">${values}</div>`;
}

function renderMarket(data, cachedMarket = lastKnownMarket) {
  if ((!data || !data.assets) && !cachedMarket) {
    marketDataEl.innerHTML = `<div class="empty-state">${escapeHTML(text("market.empty", "داده بازار در دسترس نیست."))}</div>`;
    $("#market-updated").textContent = "—";
    $("#market-coverage").textContent = "—";
    renderMarketDiagnostics(null);
    return;
  }
  const currentMarket = data && data.assets ? data : { assets: {}, funds: {}, history: {} };
  const labels = text("market.labels", {});
  const cards = Object.entries(labels).map(([key, label]) => {
    const item = currentMarket.assets[key];
    const hasPrice = item && item.status !== "conflicted" && item.price !== null && Number.isFinite(Number(item.price));
    if (!hasPrice) {
      const detail = marketUnavailableMessage(item, currentMarket.diagnostics?.assets?.[key]);
      const lastKnown = lastKnownPriceMarkup(key, currentMarket, cachedMarket, item);
      const conflictValues = marketConflictSourcesMarkup(item);
      return `<div class="market-row market-row-unavailable"><div><span class="asset-dot asset-${key === "dollar" ? "currency" : key}"></span><strong>${escapeHTML(label.title)}</strong><small>${escapeHTML(label.detail)}</small></div><div class="market-value"><strong>—</strong><small>${escapeHTML(detail)}</small>${conflictValues}${lastKnown}</div></div>`;
    }
    const change = item.changePct === null || item.changePct === undefined || item.changePct === "" ? NaN : Number(item.changePct);
    const changeLabel = Number.isFinite(change) ? `${change > 0 ? "+" : ""}${formatPercent(change)}` : text("market.noChange", "\u2014");
    const changeClass = change > 0.05 ? "positive" : change < -0.05 ? "negative" : "muted";
    const timeLabels = marketTimeLabels(item, currentMarket.updatedAt);
    const quality = text(`market.quality.${item.status || "healthy"}`);
    const basis = text(`market.quoteType.${item.quoteType || "direct"}`);
    return `<div class="market-row"><div><span class="asset-dot asset-${key === "dollar" ? "currency" : key}"></span><strong>${escapeHTML(label.title)}</strong><small>${escapeHTML(label.detail)} · ${escapeHTML(basis)}</small></div><div class="market-value"><strong>${formatIRR(item.price)} <small>${escapeHTML(marketValueUnit(item))}</small></strong><span class="${changeClass}">${changeLabel}</span><small>${escapeHTML(quality)} · ${escapeHTML(String(item.sourceCount || 0))} ${escapeHTML(text("market.sources", "منبع"))}</small><small>${escapeHTML(timeLabels)}</small></div></div>`;
  }).join("");
  const fixed = currentMarket.funds && currentMarket.funds.fixedIncome;
  const fixedCard = fixed && fixed.effectiveAnnualReturn !== null && fixed.effectiveAnnualReturn !== undefined && Number.isFinite(Number(fixed.effectiveAnnualReturn))
    ? `<div class="market-row"><div><span class="asset-dot asset-fixed"></span><strong>${escapeHTML(text("assets.fixed.title"))}</strong><small>${escapeHTML(text("market.fixedDetail"))}</small></div><div class="market-value"><strong>${formatPercent(fixed.effectiveAnnualReturn)}</strong><small>${escapeHTML(text("market.annual"))} · ${escapeHTML(String(fixed.sourceCount || 0))} ${escapeHTML(text("market.sources", "منبع"))}</small><small>${escapeHTML(marketTimeLabels(fixed, currentMarket.updatedAt))}</small></div></div>`
    : `<div class="market-row market-row-unavailable"><div><span class="asset-dot asset-fixed"></span><strong>${escapeHTML(text("assets.fixed.title"))}</strong><small>${escapeHTML(text("market.fixedDetail"))}</small></div><div class="market-value"><strong>—</strong><small>داده در دسترس نیست</small></div></div>`;
  marketDataEl.innerHTML = cards + fixedCard || `<div class="empty-state">${escapeHTML(text("market.empty", "داده بازار در دسترس نیست."))}</div>`;
  $("#market-updated").textContent = currentMarket.diagnostics && currentMarket.updatedAt
    ? `${text("market.updated", "آخرین خوانش")} ${formatDateTime(currentMarket.updatedAt)}`
    : text("market.liveUnavailable", "قیمت زنده معتبر دریافت نشده است");
  const sourceTotal = Object.values(currentMarket.assets).reduce((total, item) => total + (Number(item.sourceCount) || 0), 0);
  $("#market-coverage").textContent = `${sourceTotal} ${text("market.sourceQuotes", "قیمت معتبر")}`;
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
  if (value === null || value === undefined || value === "") return text("market.observationUnknown");
  const timestamp = new Date(value || 0).getTime();
  if (!Number.isFinite(timestamp)) return "زمان نامشخص";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 2) return "همین الان";
  if (minutes < 60) return `${formatIRR(minutes)} دقیقه قبل`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${formatIRR(hours)} ساعت قبل`;
  return `${formatIRR(Math.round(hours / 24))} روز قبل`;
}

function marketTimeLabels(item, retrievedFallback = null) {
  const observedAt = item?.observedAt || item?.asOf || null;
  const retrievedAt = item?.retrievedAt || retrievedFallback;
  const observed = observedAt ? `${text("market.observedAt")}: ${freshnessLabel(observedAt)}` : text("market.observationUnknown");
  const retrieved = retrievedAt ? `${text("market.retrievedAt")}: ${freshnessLabel(retrievedAt)}` : "";
  return retrieved ? `${observed} · ${retrieved}` : observed;
}

function confidenceLabel(item) {
  const count = Number(item?.sourceCount) || 0;
  if (item?.status === "provisional" || item?.confidence === "medium") return { label: "اعتماد متوسط", className: "confidence-medium" };
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

function renderMarketSnapshot(data, cachedMarket = lastKnownMarket) {
  const container = $("#dashboard-market-snapshot");
  const status = $("#dashboard-market-status");
  if (!container || !status) return;
  if ((!data || !data.assets) && !cachedMarket) {
    status.textContent = text("dashboard.marketUnavailable", "داده بازار در دسترس نیست؛ عدد ساختگی نمایش داده نمی‌شود.");
    status.className = "data-note data-note-warning";
    container.innerHTML = `<div class="empty-state">داده بازار در دسترس نیست. از صفحه بازار دوباره تلاش کن.</div>`;
    return;
  }
  const currentMarket = data && data.assets ? data : { assets: {}, funds: {}, history: {} };
  const sourceTotal = Object.values(currentMarket.assets).reduce((total, item) => total + (Number(item?.sourceCount) || 0), 0);
  status.textContent = currentMarket.diagnostics && currentMarket.updatedAt
    ? `${formatIRR(sourceTotal)} قیمت معتبر · ${freshnessLabel(currentMarket.updatedAt)}`
    : text("dashboard.marketUnavailable", "داده زنده بازار در دسترس نیست؛ مقدار ثبت‌شده فقط برای مرجع است و در ارزش‌گذاری جاری وارد نمی‌شود.");
  status.className = "data-note";
  const marketKeys = ["gold", "dollar", "silver", "bitcoin", "ethereum", "bourseIndex"];
  const items = marketKeys.map((key) => {
    const item = currentMarket.assets[key];
    const label = text(`market.labels.${key}.title`, text(`assets.${key}.title`, key));
    const hasPrice = item && item.status !== "conflicted" && item.price !== null && item.price !== undefined && Number.isFinite(Number(item.price));
    if (!hasPrice) {
      const quality = marketUnavailableMessage(item, currentMarket.diagnostics?.assets?.[key]);
      const lastKnown = lastKnownPriceMarkup(key, currentMarket, cachedMarket, item);
      const conflictValues = marketConflictSourcesMarkup(item);
      return `<article class="market-snapshot-item is-unavailable"><strong>${escapeHTML(label)}</strong><b>—</b><small>${escapeHTML(quality)}</small>${conflictValues}${lastKnown}</article>`;
    }
    const change = item.changePct === null || item.changePct === undefined || item.changePct === "" ? NaN : Number(item.changePct);
    const changeClass = change > 0.05 ? "positive" : change < -0.05 ? "negative" : "muted";
    const changeLabel = Number.isFinite(change) ? `${change > 0 ? "+" : ""}${formatPercent(change)}` : text("market.noChange");
    return `<article class="market-snapshot-item"><div><span class="asset-dot asset-${key === "dollar" ? "currency" : key}"></span><strong>${escapeHTML(label)}</strong></div><b>${formatIRR(item.price)} ${escapeHTML(marketValueUnit(item))}</b><span class="${changeClass}">${escapeHTML(changeLabel)}</span><small>${escapeHTML(confidenceLabel(item).label)}</small><small>${escapeHTML(marketTimeLabels(item, currentMarket.updatedAt))}</small></article>`;
  });
  const fixed = currentMarket.funds?.fixedIncome;
  items.push(fixed && fixed.effectiveAnnualReturn !== null && fixed.effectiveAnnualReturn !== undefined && Number.isFinite(Number(fixed.effectiveAnnualReturn)) ? `<article class="market-snapshot-item"><div><span class="asset-dot asset-fixed"></span><strong>درآمد ثابت</strong></div><b>${formatPercent(fixed.effectiveAnnualReturn)}</b><span class="muted">بازده موثر سالانه</span><small>${escapeHTML(confidenceLabel(fixed).label)}</small><small>${escapeHTML(marketTimeLabels(fixed, currentMarket.updatedAt))}</small></article>` : `<article class="market-snapshot-item is-unavailable"><strong>درآمد ثابت</strong><b>—</b><small>داده در دسترس نیست</small></article>`);
  container.innerHTML = items.join("");
}

function renderMarketDiagnostics(data) {
  const container = $("#market-diagnostics");
  if (!container) return;
  if (!data?.diagnostics) {
    container.innerHTML = `<div class="empty-state">تشخیص منبع برای این پاسخ در دسترس نیست.</div>`;
    return;
  }
  const providerNames = { providerA: "TGJU", providerB: "Bonbast", providerC: "Navasan", auxiliary: "ChartGoldPrice", coinGecko: "CoinGecko", binance: "Binance", metalsLive: "Metals.live", yahooMetals: "Yahoo Finance", tsetmc: "TSETMC", tgjuIndex: "TGJU · شاخص کل", fixedIncome: "کاریزما" };
  const providers = Object.entries(data.diagnostics.providers || {}).map(([id, item]) => {
    const status = item.status === "fulfilled"
      ? Number(item.quoteCount) > 0 ? text("market.providerResponded") : text("market.providerEmpty")
      : item.status === "skipped" ? text("market.providerSkipped") : text("market.providerFailed");
    return `<div class="diagnostic-row"><div><strong>${escapeHTML(providerNames[id] || id)}</strong><small>${escapeHTML(status)}</small></div><b>${formatIRR(item.quoteCount || 0)} ${escapeHTML(text("market.providerQuotesReturned"))}</b></div>`;
  }).join("");
  const coverageItems = Object.entries(data.diagnostics.assets || {});
  const fixedIncomeDiagnostics = data.diagnostics.funds?.fixedIncome;
  if (fixedIncomeDiagnostics) coverageItems.push(["fixedIncome", fixedIncomeDiagnostics]);
  const assets = coverageItems.map(([id, item]) => {
    const label = id === "fixedIncome" ? text("assets.fixed.title") : text(`market.labels.${id}.title`, text(`assets.${id}.title`, id));
    const unavailable = item.status === "conflicted" || item.reason
      ? marketUnavailableMessage(null, item)
      : text("market.coverageUnavailable");
    const isUsable = Number(item.successful) > 0;
    return `<div class="diagnostic-row"><div><strong>${escapeHTML(label)}</strong><small>${formatIRR(item.successful || 0)} از ${formatIRR(item.attempted || 0)} منبع</small></div><b class="${isUsable ? "positive" : "negative"}">${isUsable ? escapeHTML(text("market.usable")) : escapeHTML(unavailable)}</b></div>`;
  }).join("");
  const consensusCalibrated = data.diagnostics.consensusCalibrated;
  const consensusNote = consensusCalibrated === true
    ? text("market.consensusCalibrated")
    : consensusCalibrated === false ? text("market.consensusUncalibrated") : text("market.consensusUnknown");
  const responseTime = Number.isFinite(Number(data.diagnostics.responseTimeMs)) ? `<p>${escapeHTML(text("market.responseTime"))}: ${formatIRR(data.diagnostics.responseTimeMs)} ${escapeHTML(text("market.milliseconds"))} / ${formatIRR(data.diagnostics.interactiveBudgetMs || 3500)} ${escapeHTML(text("market.milliseconds"))}</p>` : "";
  container.innerHTML = `<div><span class="kicker">منابع</span>${providers || `<div class="empty-state">موردی نیست.</div>`}</div><div><span class="kicker">پوشش دارایی</span>${assets || `<div class="empty-state">موردی نیست.</div>`}</div><div class="diagnostic-method"><span class="kicker">روش تجمیع</span><p>${escapeHTML(text("market.aggregationPolicy"))} ${escapeHTML(consensusNote)}</p>${responseTime}</div>`;
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
  renderMarketSnapshot(liveMarket, lastKnownMarket);
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
  const rows = ASSET_KEYS.map((key) => {
    const meta = assetMeta(key);
    const drift = Number(plan.drift?.[key]) || 0;
    const driftLabel = `${drift > 0 ? "+" : ""}${formatPercent(drift)} ${text("allocation.percentagePoints")}`;
    return `<div class="contribution-row"><span><span class="asset-dot ${escapeHTML(meta.dotClass)}"></span>${escapeHTML(meta.title)}<small>${escapeHTML(text("allocation.current"))} ${formatPercent(plan.currentWeights?.[key] || 0)} · ${escapeHTML(text("allocation.target"))} ${formatPercent(plan.weights[key])} · ${escapeHTML(text("allocation.drift"))} ${escapeHTML(driftLabel)}</small></span><strong>${formatIRR(plan.amounts[key])} ${escapeHTML(text("currencyUnit"))}</strong></div>`;
  }).join("");
  const excluded = Number(plan.excludedInvestableTotal) || 0;
  const note = excluded > 0 ? `<p class="data-note">${escapeHTML(text("allocation.excludedHoldings"))} ${formatIRR(excluded)} ${escapeHTML(text("currencyUnit"))}</p>` : "";
  const missingCount = Number(plan.excludedMissingCount) || 0;
  const missingNote = missingCount > 0 ? `<p class="data-note">${escapeHTML(text("allocation.excludedMissingPrices"))} ${formatIRR(missingCount)}</p>` : "";
  contributionPlanEl.innerHTML = rows + note + missingNote;
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
    const portfolioIds = new Set(assetIds(portfolio));
    const marketIds = Object.entries(INSTRUMENT_REGISTRY)
      .filter(([, instrument]) => instrument.tradable !== false)
      .map(([instrumentId, instrument]) => instrument.recommendationAssetId || instrumentId);
    const coreIds = ["fixed", "cash", "other"];
    const manualIds = Object.keys(portfolio.assets || {});
    const supported = [...new Set([...marketIds, ...coreIds, ...manualIds])].filter((assetId) => portfolioIds.has(assetId));
    const current = marketSelect.value;
    const optionMarkup = (assetId) => {
      const meta = portfolioAssetMeta(assetId, portfolio);
      return `<option value="${escapeHTML(assetId)}">${escapeHTML(meta.title)}</option>`;
    };
    const marketOptions = supported.filter((assetId) => marketIds.includes(assetId)).map(optionMarkup).join("");
    const coreOptions = supported.filter((assetId) => coreIds.includes(assetId)).map(optionMarkup).join("");
    const manualOptions = supported.filter((assetId) => manualIds.includes(assetId)).map(optionMarkup).join("");
    marketSelect.innerHTML = (marketOptions ? `<optgroup label="دارایی‌های بازار">${marketOptions}</optgroup>` : "")
      + (coreOptions ? `<optgroup label="نقد و درآمد ثابت">${coreOptions}</optgroup>` : "")
      + (manualOptions ? `<optgroup label="دارایی‌های نام‌دار">${manualOptions}</optgroup>` : "");
    if (supported.includes(current)) marketSelect.value = current;
    const unit = $("#portfolio-market-asset-unit");
    if (unit) unit.textContent = portfolioUnitLabel(marketSelect.value, portfolio.assets?.[marketSelect.value]?.unit || (marketSelect.value === "currency" ? "TOMAN" : ""));
    updateMarketEntryAvailability();
  }
}

function marketEntryPriceAt(assetId, dateValue) {
  const today = new Date().toISOString().slice(0, 10);
  const definition = readPortfolio().assets?.[assetId] || PORTFOLIO_ASSETS[assetId];
  const marketKey = definition?.marketKey;
  if (dateValue === today && marketKey) {
    const current = liveMarket?.assets?.[marketKey];
    const currentPrice = Number(current?.price);
    if (Number.isFinite(currentPrice) && currentPrice > 0 && current.status !== "conflicted" && current.status !== "unavailable") return currentPrice;
  }
  if (!dateValue) return null;
  const pointInTime = dateValue === today ? new Date().toISOString() : dateValue + "T23:59:59.999Z";
  return marketPriceAt(liveMarket || {}, assetId, pointInTime);
}

function updateMarketEntryAvailability() {
  const assetId = $("#portfolio-market-asset")?.value;
  const dateValue = $("#portfolio-market-date")?.value;
  const priceAtAcquisition = assetId ? marketEntryPriceAt(assetId, dateValue) : null;
  const needsPrice = !(Number.isFinite(Number(priceAtAcquisition)) && Number(priceAtAcquisition) > 0);
  const isBackdated = dateValue && dateValue !== new Date().toISOString().slice(0, 10);
  const fields = $("#portfolio-market-acquisition-fields");
  const priceInput = $("#portfolio-market-acquisition-price");
  const hint = $("#portfolio-market-acquisition-hint");
  if (fields) fields.classList.toggle("is-hidden", !needsPrice && !isBackdated);
  if (priceInput) priceInput.required = needsPrice;
  if (hint) hint.textContent = needsPrice
    ? "قیمت خرید واقعی را وارد کن؛ این عدد برای ارزش امروز استفاده نمی‌شود."
    : "در صورت نیاز، بهای واقعی خرید را وارد کن؛ خالی = مشاهده بازار در تاریخ خرید.";
}

function renderEmergencyCoverage(portfolioResult = null) {
  const result = portfolioResult || calculatePortfolio(readPortfolio(), liveMarket || {});
  const hasTransactions = result.transactions.length > 0;
  const essentialExpenses = Math.max(0, numberFromInput($("#essential-monthly-expenses")?.value));
  const coverageMonths = essentialExpenses > 0 ? result.liquidTotal / essentialExpenses : null;
  const coverageLabel = coverageMonths === null
    ? text("portfolio.coverageMissing")
    : `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(coverageMonths)} ${text("portfolio.months")}`;
  const coverageMetric = $("#portfolio-emergency-coverage");
  if (coverageMetric) coverageMetric.textContent = coverageLabel;
  const emergencyStatus = $("#emergency-fund-status");
  if (emergencyStatus) emergencyStatus.textContent = coverageMonths === null
    ? text(`portfolio.emergency.${legacyEmergencyFund}`)
    : `${coverageLabel} · ${text(`portfolio.emergency.${coverageMonths >= 6 ? "complete" : coverageMonths >= 1 ? "partial" : "none"}`)}`;
  const liquidMetric = $("#portfolio-liquid-total");
  if (liquidMetric) liquidMetric.textContent = hasTransactions ? portfolioValueLabel(result.liquidTotal) : "—";
  return { coverageMonths, status: coverageMonths === null ? legacyEmergencyFund : coverageMonths >= 6 ? "complete" : coverageMonths >= 1 ? "partial" : "none" };
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
  $("#portfolio-net-worth").textContent = hasTransactions && !result.missingPrices.length ? portfolioValueLabel(result.netWorth) : text("portfolio.unavailable");
  $("#portfolio-investable-total").textContent = hasTransactions && !result.missingPrices.length ? portfolioValueLabel(result.investableTotal) : text("portfolio.unavailable");
  renderEmergencyCoverage(result);
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

function renderSimulation(simulation, monteCarlo, validation = null) {
  simulationSummaryEl.innerHTML = [
    [text("analysis.invested"), `${formatIRR(simulation.totalInvested)} ${text("currencyUnit")}`],
    [text("analysis.final"), `${formatIRR(simulation.finalValue)} ${text("currencyUnit")}`],
    [text("analysis.realFinal"), `${formatIRR(simulation.finalRealValue)} ${text("currencyUnit")}`],
    [text("analysis.drawdown"), formatPercent(simulation.maxDrawdown * 100)],
    [text("analysis.volatility"), formatPercent((monteCarlo.volatility || 0) * 100)],
    [text("analysis.sortino"), Number.isFinite(monteCarlo.sortino) ? monteCarlo.sortino.toFixed(2) : "—"],
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
  const methodNames = { gaussian: text("analysis.modelGaussian"), ewma: text("analysis.modelEwma"), "block-bootstrap": text("analysis.modelBootstrap") };
  const validationStatus = validation?.available ? text("analysis.validationPassed") : text("analysis.validationInsufficient");
  const assumptionVersion = monteCarlo.model?.fixed?.assumptionVersion || "ir-planning-v1";
  $("#analysis-method-note").textContent = `${text("analysis.modelVersion")}: ${methodNames[monteCarlo.method] || methodNames.gaussian} · ${text("analysis.monteCarloVersion")}: ${monteCarlo.modelVersion} · ${text("analysis.modelAssumptionVersion")}: ${assumptionVersion} · ${text("analysis.validation")}: ${validationStatus}`;
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
  const metric = (label, value, percent = false) => {
    const formatted = value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : percent ? formatPercent(Number(value) * 100) : `${formatIRR(value)} ${text("currencyUnit")}`;
    return `<div class="metric"><small>${escapeHTML(label)}</small><strong>${escapeHTML(formatted)}</strong></div>`;
  };
  const riskMetrics = `${metric(text("backtest.medianVolatility"), result.median.volatility, true)}${metric(text("backtest.medianSortino"), result.median.sortino, true)}`;
  const sharpe = Number.isFinite(result.median.sharpe)
    ? `<details class="advanced-risk-metric"><summary>${escapeHTML(text("backtest.advancedSharpe"))}</summary><div class="metric-grid">${metric(text("backtest.medianSharpe"), result.median.sharpe, true)}<p class="data-note">${escapeHTML(text("backtest.sharpeReference"))}: ${formatPercent((result.referenceAnnualReturn || 0) * 100)} ${escapeHTML(text("backtest.referenceFixedIncome"))}</p></div></details>`
    : "";
  backtestEl.innerHTML = `<div class="backtest-note">${escapeHTML(result.estimated ? text("backtest.partial") : text("backtest.full"))} ${escapeHTML(text("backtest.observations"))}: ${escapeHTML(String(result.observations))}</div><div class="metric-grid">${metric(text("backtest.medianFinal"), result.median.finalValue)}${metric(text("backtest.medianCagr"), result.median.cagr, true)}${metric(text("backtest.medianReal"), result.median.inflationAdjustedReturn, true)}${metric(text("backtest.medianDrawdown"), result.median.maxDrawdown, true)}${riskMetrics}</div>${sharpe}<div class="best-worst"><div><small>${escapeHTML(text("backtest.best"))}</small><strong>${escapeHTML(result.best.start)} ${escapeHTML(text("to"))} ${escapeHTML(result.best.end)}</strong><span>${formatPercent(result.best.cagr * 100)}</span></div><div><small>${escapeHTML(text("backtest.worst"))}</small><strong>${escapeHTML(result.worst.start)} ${escapeHTML(text("to"))} ${escapeHTML(result.worst.end)}</strong><span>${formatPercent(result.worst.cagr * 100)}</span></div></div>`;
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

function historyAssetDefinitions() {
  const marketAssets = Object.keys(INSTRUMENT_REGISTRY).map((assetId) => ({
    id: assetId,
    name: text("market.labels." + assetId + ".title", assetMeta(assetId).title),
    color: HISTORY_CHART_COLORS[assetId] || "#667785",
    dotClass: assetId === "dollar" ? "asset-currency" : "asset-" + assetId,
  }));
  return [
    { id: "portfolio", name: "پرتفوی تو", color: HISTORY_CHART_COLORS.portfolio, dotClass: "asset-fixed" },
    ...marketAssets,
  ];
}

function historyCoverageMessage(assetId) {
  if (assetId === "portfolio") return "دفتر محلی";
  const coverage = historyComparisonData?.assets?.[assetId]?.coverage;
  if (!coverage) return historyComparisonLoading ? "در حال دریافت" : "برای بررسی آماده است";
  if (coverage.status === "available") return formatIRR(coverage.observationCount) + " مشاهده";
  const reasons = {
    "coingecko-demo-key-missing": "کلید Demo رمزارز تنظیم نشده",
    "dated-fx-unavailable": "نرخ دلار تاریخ‌دار موجود نیست",
    "no-matching-dated-fx": "نرخ دلار هم‌تاریخ پیدا نشد",
    "no-observed-history-source": "منبع تاریخچه ندارد",
    "provider-history-empty": "منبع تاریخچه‌ای برنگرداند",
    "provider-unavailable": "منبع پاسخ نداد",
    "history-unavailable": "تاریخچه در دسترس نیست",
  };
  return reasons[coverage.reason] || (coverage.status === "insufficient-history" ? "مشاهده کافی نیست" : "تاریخچه در دسترس نیست");
}

function renderHistoryAssetOptions() {
  const container = $("#history-asset-options");
  if (!container) return;
  const definitions = historyAssetDefinitions();
  const selectedCount = historyComparisonSelection.size;
  $("#history-selected-count").textContent = formatIRR(selectedCount) + " انتخاب";
  container.innerHTML = definitions.map((asset) => {
    const checked = historyComparisonSelection.has(asset.id) ? " checked" : "";
    return `<label class="history-asset-option"><input type="checkbox" data-history-asset="${escapeHTML(asset.id)}"${checked}><span class="asset-dot ${escapeHTML(asset.dotClass)}"></span><span class="history-asset-copy"><strong>${escapeHTML(asset.name)}</strong><small>${escapeHTML(historyCoverageMessage(asset.id))}</small></span></label>`;
  }).join("");
  $$("[data-history-range]").forEach((button) => {
    const active = button.dataset.historyRange === historyComparisonRange;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function historyReasonLabel(reason) {
  if (reason === "coingecko-demo-key-missing") return "برای نمایش تاریخچه رمزارز، کلید اختیاری CoinGecko Demo را در تنظیمات سرور قرار بده.";
  if (reason === "dated-fx-unavailable" || reason === "no-matching-dated-fx") return "تاریخچه به تومان تبدیل نشد؛ نرخ دلار هم‌تاریخ موجود نیست.";
  if (reason === "no-observed-history-source") return "برای این مورد هنوز منبع تاریخچه مشاهده‌شده وجود ندارد.";
  return "تاریخچه معتبر این دارایی در این بازه در دسترس نیست.";
}

function renderHistoryMetrics(metrics) {
  const container = $("#historical-comparison-metrics");
  if (!container) return;
  container.innerHTML = metrics.map((metric) => {
    const returnValue = metric.periodReturn === null ? "—" : (metric.periodReturn > 0 ? "+" : "") + formatPercent(metric.periodReturn * 100);
    const annualizedValue = metric.annualizedReturn === null ? "—" : formatPercent(metric.annualizedReturn * 100);
    const drawdownValue = metric.maxDrawdown === null ? "—" : formatPercent(metric.maxDrawdown * 100);
    return `<article class="history-performance-card"><strong class="history-performance-title">${escapeHTML(metric.name)}</strong><div class="history-performance-values"><div><small>بازده دوره</small><b>${escapeHTML(returnValue)}</b></div><div><small>بازده سالانه‌شده</small><b>${escapeHTML(annualizedValue)}</b></div><div><small>بیشترین افت</small><b>${escapeHTML(drawdownValue)}</b></div><div><small>پوشش داده</small><b>${escapeHTML(formatPercent(metric.coverage * 100))}</b></div></div></article>`;
  }).join("");
}

function portfolioComparisonPoints() {
  const { portfolio, result } = readDashboardPortfolio();
  if (!result.trackingStart) return [];
  return portfolioSeries(portfolio, liveMarket || {}, result.trackingStart, new Date().toISOString(), numberFromInput($("#inflation-rate")?.value) / 100)
    .filter((point) => Number.isFinite(Number(point.value)) && Number(point.value) > 0)
    .map((point) => ({ date: point.date, value: Number(point.value), source: "Portfolio ledger" }));
}

function renderHistoricalComparison() {
  const chart = $("#historical-comparison-chart");
  const list = $("#historical-comparison-list");
  if (!chart || !list) return;
  renderHistoryAssetOptions();

  const assets = {};
  const selectedDefinitions = historyAssetDefinitions().filter((asset) => historyComparisonSelection.has(asset.id));
  selectedDefinitions.forEach((asset) => {
    const points = asset.id === "portfolio" ? portfolioComparisonPoints() : historyComparisonData?.assets?.[asset.id]?.points || [];
    assets[asset.id] = { name: asset.name, color: asset.color, points, source: asset.id === "portfolio" ? "Portfolio ledger" : "" };
  });
  const comparison = prepareComparableHistory(assets, historyComparisonRange);
  const series = comparison.series.map((item) => ({
    ...item,
    points: item.points.map((point) => ({ ...point, label: formatDate(point.date) })),
  }));
  chart.innerHTML = lineChartMarkup({
    series,
    ariaLabel: "مقایسه شاخصی پرتفوی و دارایی‌های بازار",
    emptyLabel: "برای این انتخاب‌ها، تاریخچه مشترک کافی وجود ندارد.",
    valueLabel: (value) => formatIRR(value) + " شاخص",
    height: 320,
  });
  renderHistoryMetrics(comparison.metrics);

  const status = $("#historical-comparison-status");
  if (status) {
    if (historyComparisonLoading) status.textContent = "در حال دریافت تاریخچه منابع انتخاب‌شده…";
    else if (historyComparisonError) status.innerHTML = escapeHTML(historyComparisonError) + ' <button id="history-comparison-retry" class="text-button" type="button">تلاش دوباره</button>';
    else if (comparison.from && comparison.to) status.textContent = "بازه مشترک: " + formatDate(comparison.from) + " تا " + formatDate(comparison.to) + " · " + formatIRR(comparison.days) + " روز";
    else status.textContent = "داده تاریخی کافی برای این ترکیب در دسترس نیست.";
  }
  list.innerHTML = selectedDefinitions.map((asset) => {
    const coverage = historyComparisonData?.assets?.[asset.id]?.coverage;
    const available = asset.id === "portfolio" ? portfolioComparisonPoints().length >= 2 : coverage?.status === "available";
    const detail = available ? historyCoverageMessage(asset.id) : asset.id === "portfolio" ? "برای دفتر پرتفوی، تاریخچه کافی ثبت نشده است." : historyReasonLabel(coverage?.reason);
    return `<div class="benchmark-item"><span class="health-dot ${available ? "health-good" : "health-neutral"}"></span><div><strong>${escapeHTML(asset.name)}</strong><small>${escapeHTML(detail)}</small></div><b>${available ? "قابل مقایسه" : "در دسترس نیست"}</b></div>`;
  }).join("");
}

function selectedHistoryMarketAssets() {
  return [...historyComparisonSelection].filter((assetId) => assetId !== "portfolio").sort();
}

async function loadHistoricalMarketHistory(force = false) {
  if (appStore.getState().activeView !== "history") return;
  const selectedAssets = selectedHistoryMarketAssets();
  const signature = historyComparisonRange + "|" + selectedAssets.join(",");
  if (!force && (signature === historyComparisonLoadedSignature || signature === historyComparisonPendingSignature)) return;
  historyComparisonRequestId += 1;
  const requestId = historyComparisonRequestId;
  historyComparisonLoading = selectedAssets.length > 0;
  historyComparisonError = null;
  if (!selectedAssets.length) {
    historyComparisonData = { assets: {} };
    historyComparisonLoadedSignature = signature;
    historyComparisonPendingSignature = "";
    historyComparisonLoading = false;
    renderHistoricalComparison();
    return;
  }
  historyComparisonPendingSignature = signature;
  renderHistoricalComparison();
  try {
    const query = "/api/history?assets=" + encodeURIComponent(selectedAssets.join(",")) + "&range=" + encodeURIComponent(historyComparisonRange);
    const response = await fetchWithTimeout(query, { cache: "no-store" }, 20000);
    if (!response.ok) throw new Error("history-api-unavailable");
    const data = await response.json();
    if (requestId !== historyComparisonRequestId) return;
    historyComparisonData = data;
    historyComparisonLoadedSignature = signature;
    historyComparisonPendingSignature = "";
    historyComparisonLoading = false;
    renderHistoricalComparison();
  } catch {
    if (requestId !== historyComparisonRequestId) return;
    historyComparisonError = "تاریخچه دریافت نشد؛ اتصال منبع را بررسی کن.";
    historyComparisonLoadedSignature = signature;
    historyComparisonPendingSignature = "";
    historyComparisonLoading = false;
    renderHistoricalComparison();
  }
}

function hideChartTooltip(chart) {
  const tooltip = chart?.querySelector(".chart-tooltip");
  if (tooltip) tooltip.hidden = true;
  if (chart) delete chart.dataset.tooltipPinned;
}

function showChartTooltip(point, pinned = false) {
  const chart = point?.closest(".line-chart");
  const tooltip = chart?.querySelector(".chart-tooltip");
  if (!chart || !tooltip) return;
  tooltip.textContent = point.getAttribute("aria-label") || point.querySelector("title")?.textContent || "";
  tooltip.hidden = false;
  const chartRect = chart.getBoundingClientRect();
  const pointRect = point.getBoundingClientRect();
  const center = pointRect.left + pointRect.width / 2 - chartRect.left;
  tooltip.style.left = clampTooltipCenter(center, tooltip.offsetWidth, chartRect.width) + "px";
  tooltip.style.top = Math.max(4, pointRect.top - chartRect.top - tooltip.offsetHeight - 9) + "px";
  if (pinned) chart.dataset.tooltipPinned = "true";
}

function chartPointsInDateOrder(chart) {
  return [...chart.querySelectorAll(".chart-dot")].sort((left, right) => {
    const byDate = Number(left.dataset.timestamp) - Number(right.dataset.timestamp);
    return byDate || Number(left.dataset.sequence) - Number(right.dataset.sequence);
  });
}

function bindChartTooltips() {
  document.addEventListener("pointerover", (event) => {
    const point = event.target.closest?.(".chart-dot");
    if (point) showChartTooltip(point);
  });
  document.addEventListener("focusin", (event) => {
    const chart = event.target.closest?.(".line-chart");
    if (!chart) return;
    if (event.target.matches("svg")) {
      const first = chartPointsInDateOrder(chart)[0];
      first?.focus();
    } else if (event.target.matches(".chart-dot")) showChartTooltip(event.target);
  });
  document.addEventListener("pointerout", (event) => {
    const chart = event.target.closest?.(".line-chart");
    if (!chart || chart.contains(event.relatedTarget) || chart.dataset.tooltipPinned === "true" || chart.contains(document.activeElement)) return;
    hideChartTooltip(chart);
  });
  document.addEventListener("click", (event) => {
    const point = event.target.closest?.(".chart-dot");
    if (!point) return;
    event.preventDefault();
    showChartTooltip(point, true);
  });
  document.addEventListener("pointerdown", (event) => {
    const point = event.target.closest?.(".chart-dot");
    if (point) {
      showChartTooltip(point, true);
      return;
    }
    if (event.target.closest?.(".line-chart")) return;
    $$(".line-chart").forEach(hideChartTooltip);
  });
  document.addEventListener("keydown", (event) => {
    const point = event.target.closest?.(".chart-dot");
    if (!point || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const chart = point.closest(".line-chart");
    const points = chartPointsInDateOrder(chart);
    const currentIndex = points.indexOf(point);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, currentIndex + (event.key === "ArrowRight" ? 1 : -1)));
    if (points[nextIndex]) {
      event.preventDefault();
      points[nextIndex].focus();
    }
  });
}

function calculatePlan(inputs) {
  const recommendation = recommendAllocation(inputs.profile);
  const history = readHistory();
  const portfolio = portfolioFromHistory(history, liveMarket);
  const ledger = calculatePortfolio(readPortfolio(), liveMarket || {});
  const currentHoldings = ledger.transactions.length
    ? Object.fromEntries(ASSET_KEYS.map((asset) => [asset, Math.max(0, Number(ledger.values[asset]?.value) || 0)]))
    : Object.fromEntries(ASSET_KEYS.map((key) => [key, portfolio.categories[key].value]));
  const contribution = contributionRebalance(currentHoldings, recommendation.weights, inputs.monthlyContribution);
  contribution.excludedInvestableTotal = ledger.transactions.length
    ? Math.max(0, ledger.investableTotal - Object.values(currentHoldings).reduce((total, value) => total + value, 0))
    : 0;
  contribution.excludedMissingCount = ledger.transactions.length ? ledger.missingPrices.length : 0;
  return { inputs, recommendation, contribution, portfolio };
}

function cancelAnalysisWorker() {
  if (!analysisWorkerTask) return;
  analysisRequestId += 1;
  analysisWorkerTask.worker?.terminate();
  analysisWorkerTask.resolve(null);
  analysisWorkerTask = null;
}

function runAnalysisWorker(task) {
  cancelAnalysisWorker();
  const requestId = ++analysisRequestId;
  if (typeof Worker === "undefined") return Promise.reject(new Error("analysis-worker-unavailable"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./src/analysis.worker.js", import.meta.url), { type: "module" });
    analysisWorkerTask = { worker, resolve, taskType: task.type };
    worker.addEventListener("message", (event) => {
      if (event.data?.requestId !== requestId || analysisRequestId !== requestId) return;
      worker.terminate();
      analysisWorkerTask = null;
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.result);
    });
    worker.addEventListener("error", () => {
      if (analysisRequestId !== requestId) return;
      worker.terminate();
      analysisWorkerTask = null;
      reject(new Error("analysis-worker-failed"));
    }, { once: true });
    worker.postMessage({ requestId, task });
  });
}

async function runPlanAnalysis(plan = lastPlan) {
  if (!plan) return;
  simulationSummaryEl.innerHTML = `<div class="empty-state">${escapeHTML(text("analysis.running"))}</div>`;
  try {
    const result = await runAnalysisWorker({
      type: "plan-analysis",
      options: { ...plan.inputs, market: liveMarket || {}, allocation: plan.recommendation.weights },
    });
    if (!result || appStore.getState().activeView !== "simulation" || lastPlan !== plan) return;
    analyzedPlan = plan;
    preferredAnalysisMethod = result.monteCarlo.method;
    renderSimulation(result.simulation, result.monteCarlo, result.validation);
  } catch {
    if (appStore.getState().activeView === "simulation" && lastPlan === plan) simulationSummaryEl.innerHTML = `<div class="empty-state">${escapeHTML(text("analysis.failed"))}</div>`;
  }
}

function renderPlanOutput(plan) {
  cancelAnalysisWorker();
  const { inputs, recommendation, contribution, portfolio } = plan;
  $("#monthly-investment").textContent = formatIRR(inputs.monthlyContribution);
  $("#monthly-rate").textContent = formatPercent(inputs.contributionRate);
  $("#profile-label").textContent = text(`profileLabels.${inputs.profile.riskTolerance}`, text("profileLabels.conservative"));
  allocationListEl.innerHTML = allocationRows(recommendation.weights, contribution.amounts);
  renderContributionPlan(contribution);
  renderReasons(inputs.profile, portfolio);
  $("#monthly-range").textContent = text("analysis.openForRange");
  simulationSummaryEl.innerHTML = `<div class="empty-state">${escapeHTML(text("analysis.lazy"))}</div>`;
  monteCarloEl.innerHTML = `<div class="empty-state">${escapeHTML(text("analysis.lazy"))}</div>`;
  simulationChartEl.innerHTML = `<div class="empty-state">${escapeHTML(text("analysis.lazy"))}</div>`;
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
  const acquisitionDate = $("#portfolio-market-date").value;
  const enteredPrice = Math.max(0, numberFromInput($("#portfolio-market-acquisition-price").value));
  if (!assetId || !(quantity > 0)) {
    setPortfolioStatus("دارایی و مقدار معتبر وارد کن.", "warning");
    return;
  }
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const date = acquisitionDate === today ? now : acquisitionDate;
  const marketPrice = marketEntryPriceAt(assetId, acquisitionDate);
  const unitPrice = enteredPrice > 0 ? enteredPrice : marketPrice;
  if (!(Number.isFinite(Number(unitPrice)) && Number(unitPrice) > 0)) {
    setPortfolioStatus("برای این تاریخ قیمت معتبر بازار موجود نیست؛ بهای واقعی خرید را وارد کن.", "warning");
    $("#portfolio-market-acquisition-price").focus();
    return;
  }
  const isBackdated = acquisitionDate < today;
  if (isBackdated && !window.confirm("این خرید با تاریخ گذشته ثبت می‌شود و روی محاسبات تاریخی پرتفوی اثر دارد. ادامه می‌دهی؟")) return;
  const portfolio = readPortfolio();
  const type = activePortfolioVersion(portfolio).transactions.length ? "BUY" : "OPENING";
  const transaction = createTransaction({
    type,
    assetId,
    quantity,
    unitPrice,
    source: "market-asset-entry",
    note: "Market asset entry",
    date,
  }, liveMarket || {}, now, portfolio);
  if (!transaction) {
    setPortfolioStatus(text("portfolio.validation"), "warning");
    return;
  }
  const appended = appendTransactions(portfolio, [transaction], { action: type === "OPENING" ? "create-market-asset-opening" : "record-market-asset-purchase", affectsHistory: isBackdated, detail: assetId });
  if (!appended.validation.valid || !writePortfolio(appended.portfolio)) {
    setPortfolioStatus(text("portfolio.validation"), "warning");
    return;
  }
  event.target.reset();
  $("#portfolio-market-date").value = new Date().toISOString().slice(0, 10);
  renderPortfolio();
  $("#portfolio-section").open = true;
  setPortfolioStatus("دارایی در دفتر ثبت شد؛ بهای خرید از مقدار امروز جدا نگه داشته می‌شود.", "success");
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
  link.download = `synthora-history-${new Date().toISOString().slice(0, 10)}.json`;
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

async function runBacktest() {
  if (!lastPlan) {
    navigationController.goTo("plan");
    renderPlan();
  }
  if (!lastPlan) return;
  backtestEl.innerHTML = `<div class="empty-state">${escapeHTML(text("backtest.running"))}</div>`;
  const result = await runAnalysisWorker({
    type: "backtest",
    options: {
      market: liveMarket || {},
      allocation: lastPlan.recommendation.weights,
      initialInvestment: lastPlan.inputs.initialInvestment,
      monthlyContribution: lastPlan.inputs.monthlyContribution,
      contributionGrowth: lastPlan.inputs.contributionGrowth,
      inflationRate: lastPlan.inputs.inflationRate,
      horizonYears: lastPlan.inputs.profile.horizonYears,
      rebalance: lastPlan.inputs.rebalance,
    },
  }).catch(() => null);
  if (appStore.getState().activeView !== "simulation") return;
  if (result) renderBacktest(result);
  else backtestEl.innerHTML = `<div class="empty-state">${escapeHTML(text("analysis.failed"))}</div>`;
  $("#backtest-section").open = true;
  $("#backtest-section").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function runGoalPlanning(event) {
  event.preventDefault();
  const targetToday = Math.max(0, numberFromInput($("#goal-target-today").value));
  const targetDate = new Date(`${$("#goal-target-date").value}T00:00:00Z`);
  const years = (targetDate.getTime() - Date.now()) / (365.25 * 24 * 60 * 60 * 1000);
  if (!(targetToday > 0) || !(years > 0)) {
    $("#goal-result").textContent = text("goal.invalid");
    return;
  }
  $("#goal-result").textContent = text("goal.running");
  const currentPortfolio = calculatePortfolio(readPortfolio(), liveMarket || {});
  const modeledAssets = ["fixed", "gold", "currency", "silver"];
  const missingModeledAsset = modeledAssets.some((assetId) => (Number(currentPortfolio.holdings[assetId]) || 0) > 0 && currentPortfolio.values[assetId]?.value === null);
  if (missingModeledAsset) {
    $("#goal-result").textContent = text("goal.missingModelPrices");
    return;
  }
  const modeledCapital = modeledAssets.reduce((total, assetId) => total + Math.max(0, Number(currentPortfolio.values[assetId]?.value) || 0), 0);
  const excludedCapital = Math.max(0, currentPortfolio.investableTotal - modeledCapital);
  const excludedMissingCount = currentPortfolio.missingPrices.filter((assetId) => !modeledAssets.includes(assetId)).length;
  const inputs = getPlanInputs();
  const allocation = lastPlan?.recommendation.weights || recommendAllocation(inputs.profile).weights;
  const result = await runAnalysisWorker({
    type: "goal",
    options: {
      market: liveMarket || {},
      allocation,
      initialInvestment: modeledCapital,
      monthlyContribution: lastPlan?.inputs.monthlyContribution || inputs.monthlyContribution,
      contributionGrowth: inputs.contributionGrowth,
      inflationRate: inputs.inflationRate,
      horizonYears: years,
      targetToday,
      desiredProbability: Number($("#goal-success-target").value),
      paths: 1000,
      method: preferredAnalysisMethod,
      rebalance: inputs.rebalance,
    },
  }).catch(() => null);
  if (appStore.getState().activeView !== "simulation") return;
  if (!result?.available) {
    $("#goal-result").textContent = text("goal.unavailable");
    return;
  }
  const success = formatPercent(result.successProbability * 100);
  const required = result.feasible ? `${formatIRR(result.requiredMonthlyContribution)} ${text("currencyUnit")}` : text("goal.unreachable");
  const excludedNote = excludedCapital > 0 ? ` ${text("goal.excludedCapital")}: ${formatIRR(excludedCapital)} ${text("currencyUnit")}.` : "";
  const missingNote = excludedMissingCount > 0 ? ` ${text("goal.excludedMissingPrices")}: ${formatIRR(excludedMissingCount)}.` : "";
  const modelNote = ` ${text("goal.modelVersion")}: ${result.modelVersion} · ${text("analysis.modelAssumptionVersion")}: ${result.modelAssumptionVersion || "ir-planning-v1"}.`;
  $("#goal-result").innerHTML = `<div class="goal-metrics"><div><small>${escapeHTML(text("goal.success"))}</small><strong>${escapeHTML(success)}</strong></div><div><small>${escapeHTML(text("goal.outcomes"))}</small><strong>${formatIRR(result.outcomes.p10)} / ${formatIRR(result.outcomes.p50)} / ${formatIRR(result.outcomes.p90)} ${escapeHTML(text("currencyUnit"))}</strong></div><div><small>${escapeHTML(text("goal.targetNominal"))}</small><strong>${formatIRR(result.targetNominal)} ${escapeHTML(text("currencyUnit"))}</strong></div><div><small>${escapeHTML(text("goal.requiredContribution"))}</small><strong>${escapeHTML(required)}</strong></div></div><p>${escapeHTML(result.estimated ? text("analysis.estimated") : text("analysis.observed"))}${escapeHTML(excludedNote)}${escapeHTML(missingNote)}${escapeHTML(modelNote)}</p>`;
  if (analyzedPlan !== lastPlan && appStore.getState().activeView === "simulation") runPlanAnalysis(lastPlan);
}

async function loadMarket() {
  setStatus(text("status.loading", fallbackCopy.status.loading), "loading");
  appStore.setState({ marketStatus: "loading", error: null });
  const cacheDisabled = appStore.getState().marketCacheDisabled;
  lastKnownMarket = cacheDisabled ? null : readJson(MARKET_CACHE_KEY, null);
  try {
    const assets = marketRequestAssets();
    const response = await fetchWithTimeout(`/api/market?assets=${encodeURIComponent(assets.join(","))}`, { cache: "default" });
    if (!response.ok) throw new Error("Market request failed");
    liveMarket = await response.json();
    const cacheDisabledNow = appStore.getState().marketCacheDisabled;
    if (!cacheDisabledNow) writeJson(MARKET_CACHE_KEY, liveMarket);
    else lastKnownMarket = null;
    appStore.setState({ market: liveMarket, marketStatus: "connected" });
    renderMarket(liveMarket, lastKnownMarket);
    renderHistory();
    renderPortfolio();
    renderDashboard();
    setStatus(text("status.connected", fallbackCopy.status.connected), "success");
  } catch {
    const cacheDisabledNow = appStore.getState().marketCacheDisabled;
    lastKnownMarket = cacheDisabledNow ? null : readJson(MARKET_CACHE_KEY, null);
    const cachedHistory = lastKnownMarket && typeof lastKnownMarket === "object" ? lastKnownMarket : null;
    liveMarket = cachedHistory ? {
      ...cachedHistory,
      assets: {},
      funds: {},
      diagnostics: null,
      _cachedFallbackOnly: true,
      _currentQuotesUnavailableAt: new Date().toISOString(),
    } : null;
    appStore.setState({ market: liveMarket, marketStatus: liveMarket ? "cached" : "unavailable" });
    renderMarket(liveMarket, lastKnownMarket);
    renderHistory();
    renderPortfolio();
    renderDashboard();
    setStatus(liveMarket ? text("status.cached", fallbackCopy.status.cached) : text("status.timeout", fallbackCopy.status.unavailable), "warning");
  }
}

function marketRequestAssets() {
  const requested = new Set([...Object.keys(text("market.labels", {})), "fixedIncome"]);
  const supported = new Set(Object.keys(INSTRUMENT_REGISTRY));
  const portfolio = readPortfolio();
  assetIds(portfolio).forEach((assetId) => {
    const definition = portfolio.assets?.[assetId] || PORTFOLIO_ASSETS[assetId];
    const marketKey = definition?.marketKey;
    if (marketKey && supported.has(marketKey)) requested.add(marketKey);
  });
  return [...requested].filter((assetId) => supported.has(assetId) || assetId === "fixedIncome");
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
  $$("[data-history-range]").forEach((button) => button.addEventListener("click", () => {
    const nextRange = button.dataset.historyRange;
    if (!nextRange || nextRange === historyComparisonRange) return;
    historyComparisonRange = nextRange;
    historyComparisonData = null;
    historyComparisonLoadedSignature = "";
    loadHistoricalMarketHistory();
  }));
  $("#history-asset-options")?.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-history-asset]");
    if (!checkbox) return;
    if (checkbox.checked) historyComparisonSelection.add(checkbox.dataset.historyAsset);
    else historyComparisonSelection.delete(checkbox.dataset.historyAsset);
    historyComparisonData = null;
    historyComparisonLoadedSignature = "";
    loadHistoricalMarketHistory();
  });
  $("#historical-comparison-status")?.addEventListener("click", (event) => {
    if (event.target.closest("#history-comparison-retry")) loadHistoricalMarketHistory(true);
  });
  $("#refresh-market").addEventListener("click", loadMarket);
  $("#run-backtest").addEventListener("click", runBacktest);
  $("#goal-form")?.addEventListener("submit", runGoalPlanning);
  $("#analysis-section")?.addEventListener("toggle", () => {
    if ($("#analysis-section").open && appStore.getState().activeView === "simulation" && lastPlan && analyzedPlan !== lastPlan) runPlanAnalysis(lastPlan);
  });
  $("#export-history").addEventListener("click", exportHistory);
  $("#import-history").addEventListener("click", () => $("#history-file").click());
  $("#history-file").addEventListener("change", importHistoryFile);
  $("#simple-portfolio-form").addEventListener("submit", handleSimplePortfolioSubmit);
  $("#stock-entry-form").addEventListener("submit", handleStockEntrySubmit);
  $("#portfolio-market-asset-form")?.addEventListener("submit", handleMarketAssetSubmit);
  $("#portfolio-market-asset")?.addEventListener("change", () => populatePortfolioAssetOptions());
  $("#portfolio-market-date")?.addEventListener("change", updateMarketEntryAvailability);
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
    if (disabled) {
      localStorage.removeItem(MARKET_CACHE_KEY);
      lastKnownMarket = null;
      if (liveMarket?._cachedFallbackOnly || appStore.getState().marketStatus === "cached") {
        liveMarket = null;
        appStore.setState({ market: null, marketStatus: "unavailable" });
      }
      renderMarket(liveMarket, null);
      renderDashboard();
    }
    setStatus(disabled ? "ذخیره بازار خاموش است" : text("status.connected", fallbackCopy.status.connected), disabled ? "warning" : "success");
  });
  $("#settings-clear-market-cache").addEventListener("click", () => {
    localStorage.removeItem(MARKET_CACHE_KEY);
    lastKnownMarket = null;
    if (liveMarket?._cachedFallbackOnly) {
      liveMarket = null;
      appStore.setState({ market: null, marketStatus: "unavailable" });
    }
    renderMarket(liveMarket, null);
    renderDashboard();
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
  bindChartTooltips();
  appStore.subscribe((state) => {
    const toggle = $("#settings-sidebar-collapsed");
    if (toggle) toggle.checked = state.sidebarCollapsed;
    const cacheToggle = $("#settings-market-cache");
    if (cacheToggle) cacheToggle.checked = state.marketCacheDisabled;
    if (state.activeView !== "simulation") cancelAnalysisWorker();
    else if ($("#analysis-section")?.open && lastPlan && analyzedPlan !== lastPlan && analysisWorkerTask?.taskType !== "plan-analysis") runPlanAnalysis(lastPlan);
    if (state.activeView === "history") loadHistoricalMarketHistory();
  });
  $("#contribution-rate").addEventListener("input", (event) => { $("#contribution-output").textContent = formatPercent(Number(event.target.value), 0); });
  $$('[data-number-input]').forEach((input) => {
    input.value = groupedNumber(input.value);
    input.addEventListener("input", formatNumberInput);
  });
  $$("#plan-form select, #plan-form input").forEach((element) => {
    element.addEventListener("change", () => { persistProfile(); syncPlanState(); renderSettingsAssumptions(); previewPlanIfVisible(); renderDashboard(); renderEmergencyCoverage(); });
    element.addEventListener("input", () => { persistProfile(); syncPlanState(); renderSettingsAssumptions(); previewPlanIfVisible(); renderDashboard(); renderEmergencyCoverage(); });
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
  $("#portfolio-market-date").value = new Date().toISOString().slice(0, 10);
  updateMarketEntryAvailability();
  const goalDate = new Date();
  goalDate.setFullYear(goalDate.getFullYear() + 5);
  $("#goal-target-date").value = goalDate.toISOString().slice(0, 10);
  updateAdvancedTransactionFields();
  await loadMarket();
  showStorageWarning();
}

init();
