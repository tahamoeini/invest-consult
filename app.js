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
  createPortfolioVersion,
  createTransaction,
  normalizePortfolio,
  portfolioSeries,
  simpleChangeTransactions,
} from "./src/portfolio.js";

const HISTORY_KEY = "investment-plan-history-v4";
const MARKET_CACHE_KEY = "investment-plan-market-cache-v3";
const PROFILE_KEY = "investment-plan-profile-v1";
const PORTFOLIO_KEY = "invest-consult-portfolio-v1";
const HISTORY_LIMIT = 60;

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
const simpleChangePanel = $("#simple-change-panel");
const portfolioTransferStatusEl = $("#portfolio-transfer-status");

let copy;
let liveMarket = null;
let lastPlan = null;
let pendingSimpleBalances = null;

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
    .replace(/[\u066c\u060c,\s]/g, "");
}

function numberFromInput(value) {
  const parsed = Number(normalizeDigits(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
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

function setStatus(label, type = "loading") {
  statusEl.textContent = label;
  statusEl.className = `status-pill status-${type}`;
}

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function readHistory() {
  const current = readJson(HISTORY_KEY, []);
  const old = readJson("investment-plan-history-v3", []);
  return mergeHistory(current, old, HISTORY_LIMIT);
}

function readPortfolio() {
  return normalizePortfolio(readJson(PORTFOLIO_KEY, null));
}

function writePortfolio(portfolio) {
  return writeJson(PORTFOLIO_KEY, normalizePortfolio(portfolio));
}

function getProfile() {
  return {
    age: numberFromInput($("#age").value),
    horizonYears: numberFromInput($("#horizon").value),
    goal: $("#goal").value,
    riskTolerance: $("#risk-tolerance").value,
    incomeStability: $("#income-stability").value,
    emergencyFund: $("#emergency-fund").value,
  };
}

function getPlanInputs() {
  const salary = numberFromInput($("#salary").value);
  const contributionRate = clamp(numberFromInput($("#contribution-rate").value), 5, 50);
  const profile = getProfile();
  const initialInvestment = numberFromInput($("#initial-investment").value);
  const contributionGrowth = numberFromInput($("#contribution-growth").value) / 100;
  const inflationRate = numberFromInput($("#inflation-rate").value) / 100;
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

function persistProfile() {
  writeJson(PROFILE_KEY, getProfile());
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
}

function marketSnapshot(market) {
  if (!market) return null;
  const snapshot = { capturedAt: market.updatedAt || new Date().toISOString(), assets: {}, funds: {} };
  ["dollar", "gold", "silver"].forEach((key) => {
    const item = market.assets && market.assets[key];
    if (item && Number.isFinite(Number(item.price))) snapshot.assets[key] = { price: Number(item.price), changePct: Number(item.changePct) || null };
  });
  const fixed = market.funds && market.funds.fixedIncome;
  if (fixed && Number.isFinite(Number(fixed.effectiveAnnualReturn))) snapshot.funds.fixedIncome = { effectiveAnnualReturn: Number(fixed.effectiveAnnualReturn) };
  return Object.keys(snapshot.assets).length || Object.keys(snapshot.funds).length ? snapshot : null;
}

function renderMarket(data) {
  if (!data || !data.assets) {
    marketDataEl.innerHTML = `<div class="empty-state">${escapeHTML(text("market.empty", "No market data is available."))}</div>`;
    return;
  }
  const labels = text("market.labels", {});
  const cards = Object.entries(labels).map(([key, label]) => {
    const item = data.assets[key];
    if (!item || !Number.isFinite(Number(item.price))) return "";
    const change = Number(item.changePct);
    const changeLabel = Number.isFinite(change) ? `${change > 0 ? "+" : ""}${formatPercent(change)}` : text("market.noChange", "\u2014");
    const changeClass = change > 0.05 ? "positive" : change < -0.05 ? "negative" : "muted";
    return `<div class="market-row"><div><span class="asset-dot asset-${key === "dollar" ? "currency" : key}"></span><strong>${escapeHTML(label.title)}</strong><small>${escapeHTML(label.detail)}</small></div><div class="market-value"><strong>${formatIRR(item.price)} <small>${escapeHTML(text("currencyUnit"))}</small></strong><span class="${changeClass}">${changeLabel}</span><small>${escapeHTML(String(item.sourceCount || 0))} ${escapeHTML(text("market.sources", "source"))}</small></div></div>`;
  }).join("");
  const fixed = data.funds && data.funds.fixedIncome;
  const fixedCard = fixed && Number.isFinite(Number(fixed.effectiveAnnualReturn))
    ? `<div class="market-row"><div><span class="asset-dot asset-fixed"></span><strong>${escapeHTML(text("assets.fixed.title"))}</strong><small>${escapeHTML(text("market.fixedDetail"))}</small></div><div class="market-value"><strong>${formatPercent(fixed.effectiveAnnualReturn)}</strong><small>${escapeHTML(text("market.annual"))}</small></div></div>`
    : "";
  marketDataEl.innerHTML = cards + fixedCard || `<div class="empty-state">${escapeHTML(text("market.empty", "No market data is available."))}</div>`;
  $("#market-updated").textContent = data.updatedAt ? `${text("market.updated", "Updated")} ${formatDateTime(data.updatedAt)}` : "\u2014";
  const sourceTotal = Object.values(data.assets).reduce((total, item) => total + (Number(item.sourceCount) || 0), 0);
  $("#market-coverage").textContent = `${sourceTotal} ${text("market.sourceQuotes", "valid source quotes")}`;
}

function assetMeta(key) {
  return text(`assets.${key}`, { title: key, description: "", dotClass: `asset-${key}` });
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
  if (!points || points.length < 2) {
    container.innerHTML = `<div class="empty-state">${escapeHTML(text("analysis.chartEmpty", "Not enough data for a chart."))}</div>`;
    return;
  }
  const values = points.map((point) => Number(point[valueKey]) || 0);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const bars = values.map((value, index) => {
    const height = Math.max(3, ((value - min) / Math.max(max - min, 1)) * 100);
    const title = `${label} ${index + 1}: ${formatIRR(value)} ${text("currencyUnit")}`;
    return `<span class="chart-bar" style="height:${height}%" title="${escapeHTML(title)}"></span>`;
  }).join("");
  container.innerHTML = `<div class="bar-chart" aria-label="${escapeHTML(label)}">${bars}</div>`;
}

function formatPortfolioQuantity(assetId, quantity) {
  if (assetId === "gold" || assetId === "silver") return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 3 }).format(Number(quantity) || 0);
  return formatIRR(quantity);
}

function portfolioValueLabel(value) {
  return value === null || value === undefined ? text("portfolio.unavailable", "Unavailable") : `${formatIRR(value)} ${text("currencyUnit")}`;
}

function renderPortfolioChart(series) {
  const chart = $("#portfolio-chart");
  if (!series.length) {
    chart.innerHTML = `<div class="empty-state">${escapeHTML(text("portfolio.empty"))}</div>`;
    return;
  }
  const values = series.map((point) => point.value).filter((value) => Number.isFinite(value));
  if (!values.length) {
    chart.innerHTML = `<div class="empty-state">${escapeHTML(text("portfolio.missingPrices"))}</div>`;
    return;
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const bars = series.map((point) => {
    if (!Number.isFinite(point.value)) return `<span class="chart-gap" title="${escapeHTML(text("portfolio.missingPrices"))}"></span>`;
    const height = Math.max(3, ((point.value - min) / Math.max(max - min, 1)) * 100);
    return `<span class="chart-bar" style="height:${height}%" title="${escapeHTML(formatDate(point.date))}: ${escapeHTML(portfolioValueLabel(point.value))}"></span>`;
  }).join("");
  chart.innerHTML = `<div class="bar-chart" aria-label="${escapeHTML(text("portfolio.chart"))}">${bars}</div>`;
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

function renderPortfolio() {
  if (!portfolioAllocationEl) return;
  const portfolio = readPortfolio();
  const asOf = new Date().toISOString();
  const inflationRate = numberFromInput($("#inflation-rate").value) / 100;
  const result = calculatePortfolio(portfolio, liveMarket || {}, asOf, inflationRate);
  const version = activePortfolioVersion(portfolio);
  const hasTransactions = result.transactions.length > 0;
  $("#portfolio-current-value").textContent = portfolioValueLabel(result.currentValue);
  $("#portfolio-net-invested").textContent = portfolioValueLabel(result.netInvested);
  $("#portfolio-profit-loss").textContent = portfolioValueLabel(result.profitLoss);
  $("#portfolio-profit-loss").className = result.profitLoss >= 0 ? "positive" : "negative";
  $("#portfolio-cagr").textContent = result.cagr === null ? text("portfolio.unavailable") : formatPercent(result.cagr * 100);
  $("#portfolio-real-return").textContent = result.inflationAdjustedReturn === null ? text("portfolio.unavailable") : formatPercent(result.inflationAdjustedReturn * 100);
  $("#portfolio-start-date").textContent = result.trackingStart ? formatDate(result.trackingStart) : text("portfolio.notStarted");
  const versionLabel = version.label === "Initial portfolio" ? text("portfolio.initialLabel") : version.label;
  $("#portfolio-version-label").textContent = versionLabel;
  $("#portfolio-version-count").textContent = `${portfolio.versions.length} ${text("portfolio.versionCount")}`;
  $("#portfolio-audit-count").textContent = `${version.audit.length} ${text("portfolio.auditCount")}`;

  const allocationRows = assetIds().map((assetId) => {
    const meta = assetMeta(assetId);
    const item = result.values[assetId];
    return `<div class="allocation-row"><div class="allocation-name"><span class="asset-dot ${escapeHTML(meta.dotClass)}"></span><div><strong>${escapeHTML(meta.title)}</strong><small>${escapeHTML(formatPortfolioQuantity(assetId, item.quantity))} ${escapeHTML(text(`portfolio.units.${assetId}`, item.unit))}</small></div></div><div class="allocation-numbers"><strong>${item.value === null ? escapeHTML(text("portfolio.unavailable")) : formatPercent(result.allocation[assetId])}</strong><small>${escapeHTML(portfolioValueLabel(item.value))}</small></div></div>`;
  }).join("");
  portfolioAllocationEl.innerHTML = allocationRows;

  const quality = $("#portfolio-data-quality");
  if (!hasTransactions) quality.textContent = text("portfolio.empty");
  else if (result.missingPrices.length) quality.textContent = `${text("portfolio.missingPrices")} ${result.missingPrices.map((assetId) => assetMeta(assetId).title).join(", ")}`;
  else quality.textContent = text("portfolio.complete");
  quality.className = `data-note ${result.missingPrices.length ? "data-note-warning" : ""}`;

  populateSimpleBalances(result.holdings);
  const series = result.trackingStart ? portfolioSeries(portfolio, liveMarket || {}, result.trackingStart, asOf, inflationRate) : [];
  renderPortfolioChart(series);
  if (hasTransactions && result.trackingStart && new Date(result.trackingStart).toDateString() === new Date(asOf).toDateString()) {
    $("#portfolio-chart-note").textContent = text("portfolio.startsToday");
  } else {
    $("#portfolio-chart-note").textContent = text("portfolio.chartNote");
  }

  portfolioLedgerEl.innerHTML = hasTransactions ? result.transactions.slice().reverse().slice(0, 20).map((transaction) => {
    const type = text(`portfolio.transactionTypes.${transaction.type}`, transaction.type);
    const meta = assetMeta(transaction.assetId);
    const quantity = transaction.quantity === undefined ? transaction.amount : transaction.quantity;
    const unit = transaction.quantity === undefined ? text("currencyUnit") : text(`portfolio.units.${transaction.assetId}`, meta.unit);
    const target = transaction.type === "TRANSFER" ? ` ${text("portfolio.to")} ${escapeHTML(assetMeta(transaction.targetAssetId).title)}` : "";
    return `<div class="ledger-row"><div><strong>${escapeHTML(type)}</strong><small>${escapeHTML(formatDate(transaction.date))} ${escapeHTML(text("history.separator"))} ${escapeHTML(meta.title)}${target}</small></div><div><strong>${escapeHTML(formatPortfolioQuantity(transaction.assetId, quantity))}</strong><small>${escapeHTML(unit)}</small></div></div>`;
  }).join("") : `<div class="empty-state">${escapeHTML(text("portfolio.noLedger"))}</div>`;

  portfolioAuditEl.innerHTML = version.audit.length ? version.audit.slice().reverse().slice(0, 12).map((event) => `<div class="audit-row"><div><strong>${escapeHTML(text(`portfolio.auditActions.${event.action}`, event.action))}</strong><small>${escapeHTML(formatDateTime(event.timestamp))}</small></div><span class="audit-${event.affectsHistory ? "history" : "normal"}">${escapeHTML(event.affectsHistory ? text("portfolio.auditHistory") : text("portfolio.auditNormal"))}</span></div>`).join("") : `<div class="empty-state">${escapeHTML(text("portfolio.noAudit"))}</div>`;
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
}

function renderPlan() {
  const inputs = getPlanInputs();
  if (!(inputs.salary > 0)) {
    $("#salary").focus();
    $("#salary").setCustomValidity(text("errors.salary", fallbackCopy.errors.salary));
    $("#salary").reportValidity();
    return;
  }
  $("#salary").setCustomValidity("");
  persistProfile();
  const recommendation = recommendAllocation(inputs.profile);
  const history = readHistory();
  const portfolio = portfolioFromHistory(history, liveMarket);
  const currentHoldings = Object.fromEntries(ASSET_KEYS.map((key) => [key, portfolio.categories[key].value]));
  const contribution = contributionRebalance(currentHoldings, recommendation.weights, inputs.monthlyContribution);
  const modelResult = estimateReturnModel(liveMarket || {}, DEFAULT_ASSUMPTIONS);
  const simulation = simulatePlan({ ...inputs, allocation: recommendation.weights, annualReturns: modelResult.model });
  const monteCarlo = runMonteCarlo({ ...inputs, allocation: recommendation.weights, returnModel: modelResult.model, historical: modelResult.historical });
  lastPlan = { inputs, recommendation, contribution, simulation, monteCarlo, portfolio, modelResult };

  $("#monthly-investment").textContent = formatIRR(inputs.monthlyContribution);
  $("#monthly-rate").textContent = formatPercent(inputs.contributionRate);
  $("#profile-label").textContent = text(`profileLabels.${inputs.profile.riskTolerance}`, text("profileLabels.conservative"));
  allocationListEl.innerHTML = allocationRows(recommendation.weights, contribution.amounts);
  renderContributionPlan(contribution);
  renderReasons(inputs.profile, portfolio);
  renderSimulation(simulation, monteCarlo);
  resultPanel.classList.remove("is-hidden");
  saveHistory(inputs, recommendation, contribution);
  renderHistory();
  resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
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
    setPortfolioStatus(text("portfolio.saved"), "success");
    return;
  }
  pendingSimpleBalances = desired;
  simpleChangePanel.classList.remove("is-hidden");
  simpleChangePanel.scrollIntoView({ behavior: "smooth", block: "center" });
}

function applySimpleChange() {
  if (!pendingSimpleBalances) return;
  const reason = $("#simple-change-reason").value;
  const now = new Date().toISOString();
  const portfolio = readPortfolio();
  const current = calculatePortfolio(portfolio, liveMarket || {}, now);
  const affectsHistory = reason !== "new-purchase";
  if (affectsHistory && !window.confirm(text("portfolio.confirmHistoryChange"))) return;

  if (reason === "restart-tracking") {
    const openingTransactions = SIMPLE_ASSET_IDS.map((assetId) => pendingSimpleBalances[assetId] > 0 ? createTransaction({ type: "OPENING", assetId, quantity: pendingSimpleBalances[assetId], source: "simple-restart", note: "Restart tracking baseline" }, liveMarket || {}, now) : null).filter(Boolean);
    if (openingTransactions.length !== SIMPLE_ASSET_IDS.filter((assetId) => pendingSimpleBalances[assetId] > 0).length) {
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
  setPortfolioStatus(reason === "correction" ? text("portfolio.corrected") : text("portfolio.updated"), "success");
}

function cancelSimpleChange() {
  pendingSimpleBalances = null;
  simpleChangePanel.classList.add("is-hidden");
  setPortfolioStatus(text("portfolio.cancelled"), "neutral");
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
  const transaction = createTransaction(input, liveMarket || {}, now);
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
  const element = $("#history-transfer-status");
  element.textContent = message;
  element.className = `transfer-status transfer-${type}`;
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
    const current = readHistory();
    const merged = mergeHistory(current, parsed.records, HISTORY_LIMIT);
    if (!writeJson(HISTORY_KEY, merged)) throw new Error("storage-failed");
    let portfolioRestored = false;
    let portfolioSkipped = false;
    if (parsed.portfolio) {
      const currentPortfolio = readPortfolio();
      const currentHasPortfolio = activePortfolioVersion(currentPortfolio).transactions.length > 0;
      if (!currentHasPortfolio || window.confirm(text("portfolio.importConfirm"))) {
        if (!writePortfolio(parsed.portfolio)) throw new Error("storage-failed");
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
  if (!lastPlan) renderPlan();
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
  $("#backtest-section").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadMarket() {
  setStatus(text("status.loading", fallbackCopy.status.loading), "loading");
  try {
    const response = await fetch("/api/market", { cache: "no-store" });
    if (!response.ok) throw new Error("Market request failed");
    liveMarket = await response.json();
    writeJson(MARKET_CACHE_KEY, liveMarket);
    renderMarket(liveMarket);
    renderHistory();
    renderPortfolio();
    setStatus(text("status.connected", fallbackCopy.status.connected), "success");
  } catch {
    liveMarket = readJson(MARKET_CACHE_KEY, null);
    renderMarket(liveMarket);
    renderHistory();
    renderPortfolio();
    setStatus(liveMarket ? text("status.cached", fallbackCopy.status.cached) : text("status.unavailable", fallbackCopy.status.unavailable), "warning");
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
  $("#refresh-market").addEventListener("click", loadMarket);
  $("#run-backtest").addEventListener("click", runBacktest);
  $("#export-history").addEventListener("click", exportHistory);
  $("#import-history").addEventListener("click", () => $("#history-file").click());
  $("#history-file").addEventListener("change", importHistoryFile);
  $("#simple-portfolio-form").addEventListener("submit", handleSimplePortfolioSubmit);
  $("#apply-simple-change").addEventListener("click", applySimpleChange);
  $("#cancel-simple-change").addEventListener("click", cancelSimpleChange);
  $("#advanced-transaction-form").addEventListener("submit", handleAdvancedTransactionSubmit);
  $("#advanced-type").addEventListener("change", updateAdvancedTransactionFields);
  $("#clear-history").addEventListener("click", () => {
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem("investment-plan-history-v3");
    renderHistory();
    setTransferStatus(text("history.transfer.cleared"), "neutral");
  });
  $("#contribution-rate").addEventListener("input", (event) => { $("#contribution-output").textContent = formatPercent(Number(event.target.value), 0); });
  $$("#plan-form select, #plan-form input").forEach((element) => element.addEventListener("change", persistProfile));
}

async function init() {
  await loadCopy();
  restoreProfile();
  $("#contribution-output").textContent = formatPercent(Number($("#contribution-rate").value), 0);
  bindEvents();
  renderHistory();
  renderPortfolio();
  $("#advanced-date").value = new Date().toISOString().slice(0, 10);
  updateAdvancedTransactionFields();
  await loadMarket();
}

init();
