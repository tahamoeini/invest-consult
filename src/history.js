// @ts-check

import { ASSET_KEYS, clamp, normalizeAllocation } from "./engine.js";
import { PORTFOLIO_SCHEMA, PORTFOLIO_VERSION, normalizePortfolio } from "./portfolio.js";

export const HISTORY_SCHEMA = "invest-consult-history";
export const HISTORY_VERSION = 2;

const MARKET_ASSETS = ["dollar", "gold", "silver", "bitcoin", "ethereum", "tether", "platinum", "palladium", "copper", "bourseIndex"];

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function validDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sanitizeSnapshot(snapshot, fallbackDate) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const result = { capturedAt: validDate(snapshot.capturedAt) || fallbackDate, assets: {}, funds: {} };
  MARKET_ASSETS.forEach((key) => {
    const source = snapshot.assets && snapshot.assets[key];
    const price = finite(source && source.price);
    if (price !== null && price > 0) result.assets[key] = { price, changePct: finite(source.changePct), unit: typeof source.unit === "string" ? source.unit.slice(0, 20) : undefined };
  });
  const fixedReturn = finite(snapshot.funds && snapshot.funds.fixedIncome && snapshot.funds.fixedIncome.effectiveAnnualReturn);
  if (fixedReturn !== null) result.funds.fixedIncome = { effectiveAnnualReturn: fixedReturn };
  return Object.keys(result.assets).length || Object.keys(result.funds).length ? result : null;
}

function sanitizeProfile(profile) {
  if (!profile || typeof profile !== "object") return undefined;
  const result = {};
  const age = finite(profile.age);
  const horizonYears = finite(profile.horizonYears);
  if (age !== null) result.age = clamp(age, 18, 90);
  if (horizonYears !== null) result.horizonYears = clamp(horizonYears, 1, 50);
  ["goal", "riskTolerance", "incomeStability", "emergencyFund"].forEach((key) => {
    if (typeof profile[key] === "string" && profile[key].length <= 40) result[key] = profile[key];
  });
  return Object.keys(result).length ? result : undefined;
}

function sanitizeAmounts(amounts) {
  if (!amounts || typeof amounts !== "object") return undefined;
  const result = {};
  ASSET_KEYS.forEach((key) => {
    const amount = finite(amounts[key]);
    if (amount !== null && amount >= 0) result[key] = amount;
  });
  return Object.keys(result).length ? result : undefined;
}

/**
 * Keep only the fields required to reconstruct the local portfolio history.
 * Legacy records using `rate` are accepted and converted to `contributionRate`.
 */
export function sanitizeHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const createdAt = validDate(entry.createdAt);
  const total = finite(entry.total);
  const contributionRate = finite(entry.contributionRate ?? entry.rate);
  const rawWeights = entry.weights && typeof entry.weights === "object" ? entry.weights : null;
  if (!createdAt || total === null || total <= 0 || contributionRate === null || !rawWeights) return null;
  const rawWeightTotal = ASSET_KEYS.reduce((sum, key) => sum + Math.max(0, finite(rawWeights[key]) || 0), 0);
  if (rawWeightTotal <= 0) return null;

  const result = {
    createdAt,
    total,
    contributionRate: clamp(contributionRate, 0, 100),
    weights: normalizeAllocation(rawWeights),
  };
  const salary = finite(entry.salary);
  if (salary !== null && salary >= 0) result.salary = salary;
  const contributionPlan = sanitizeAmounts(entry.contributionPlan);
  if (contributionPlan) result.contributionPlan = contributionPlan;
  const profile = sanitizeProfile(entry.profile);
  if (profile) result.profile = profile;
  const marketSnapshot = sanitizeSnapshot(entry.marketSnapshot, createdAt);
  if (marketSnapshot) result.marketSnapshot = marketSnapshot;
  return result;
}

export function normalizeHistoryEntries(entries, limit = 60) {
  const seen = new Set();
  const result = [];
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const normalized = sanitizeHistoryEntry(entry);
    if (!normalized || seen.has(normalized.createdAt)) return;
    seen.add(normalized.createdAt);
    result.push(normalized);
  });
  return Number.isFinite(limit) ? result.slice(0, Math.max(0, limit)) : result;
}

export function mergeHistory(existing, incoming, limit = 60) {
  return normalizeHistoryEntries([...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])], limit);
}

export function createHistoryExport(history, portfolio = null) {
  const records = normalizeHistoryEntries(history, Infinity);
  const result = {
    schema: HISTORY_SCHEMA,
    version: HISTORY_VERSION,
    currencyUnit: "TOMAN",
    exportedAt: new Date().toISOString(),
    recordCount: records.length,
    history: records,
  };
  if (portfolio) result.portfolio = normalizePortfolio(portfolio);
  return result;
}

export function parseHistoryExport(value) {
  let data = value;
  if (Array.isArray(data)) data = { schema: HISTORY_SCHEMA, version: HISTORY_VERSION, history: data };
  if (!data || typeof data !== "object" || data.schema !== HISTORY_SCHEMA || Number(data.version) > HISTORY_VERSION || !Array.isArray(data.history)) {
    throw new Error("invalid-export-format");
  }
  const records = normalizeHistoryEntries(data.history, Infinity);
  let portfolio = null;
  if (data.portfolio !== undefined) {
    if (!data.portfolio || data.portfolio.schema !== PORTFOLIO_SCHEMA || Number(data.portfolio.version) > PORTFOLIO_VERSION || !Array.isArray(data.portfolio.versions)) throw new Error("invalid-portfolio-format");
    portfolio = normalizePortfolio(data.portfolio);
  }
  return { records, skipped: data.history.length - records.length, version: Number(data.version) || HISTORY_VERSION, currencyUnit: data.currencyUnit === "TOMAN" ? "TOMAN" : "RIAL_LEGACY", portfolio };
}
