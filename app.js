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

let liveMarket = null;

const assetMeta = {
  fixed: { title: "درآمد ثابت", description: "ستون دفاعی سبد؛ برای نوسان کمتر و نقدشوندگی بهتر", dotClass: "asset-fixed" },
  gold: { title: "طلا", description: "پوشش نسبی در برابر افت قدرت خرید", dotClass: "asset-gold" },
  currency: { title: "ارز", description: "خرید پله‌ای؛ نه یک‌جا و هیجانی", dotClass: "asset-currency" },
  silver: { title: "نقره", description: "سهم کوچک‌تر برای تنوع، با نوسان بیشتر", dotClass: "asset-silver" },
};

function normalizeDigits(value) {
  return String(value || "")
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[٬،,]/g, "")
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
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(value || 0) + "٪";
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("fa-IR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return "نامشخص";
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
  if (change === null || change === undefined || !Number.isFinite(Number(change))) return '<span class="change-flat">تغییر روزانه نامشخص</span>';
  const number = Number(change);
  const cls = number > 0.05 ? "change-up" : number < -0.05 ? "change-down" : "change-flat";
  const sign = number > 0 ? "+" : "";
  return '<span class="' + cls + '">' + sign + formatPercent(number) + " روزانه</span>";
}

function renderMarket(data) {
  if (!data || !data.assets) {
    marketDataEl.innerHTML = '<div class="empty-state">داده زنده فعلا در دسترس نیست؛ پیشنهاد پایه همچنان قابل محاسبه است.</div>';
    marketUpdatedEl.textContent = "داده‌ای دریافت نشد";
    return;
  }

  const cards = [];
  const assetLabels = {
    dollar: ["ارز", "نرخ مرجع بازار"],
    gold: ["طلا", "هر گرم طلای ۱۸ عیار"],
    silver: ["نقره", "هر گرم نقره"],
  };

  Object.keys(assetLabels).forEach((key) => {
    const item = data.assets[key];
    if (!item) return;
    const label = assetLabels[key];
    const price = item.price ? formatIRR(item.price) + " ریال" : "نامشخص";
    const dot = key === "dollar" ? "currency" : key;
    cards.push(
      '<div class="market-card">' +
        '<div class="market-card-label"><span class="asset-dot asset-' + dot + '"></span><span>' + label[0] + "<small>" + label[1] + "</small></span></div>" +
        '<div class="market-card-value"><strong>' + price + "</strong>" + renderChange(item.changePct) + "</div>" +
      "</div>"
    );
  });

  const fixedReturn = data.funds && data.funds.fixedIncome && data.funds.fixedIncome.effectiveAnnualReturn;
  if (fixedReturn !== null && fixedReturn !== undefined) {
    cards.push(
      '<div class="market-card">' +
        '<div class="market-card-label"><span class="asset-dot asset-fixed"></span><span>درآمد ثابت<small>بازده مؤثر سالانه منتشرشده</small></span></div>' +
        '<div class="market-card-value"><strong>' + formatPercent(fixedReturn) + "</strong><span>از منبع رسمی</span></div>" +
      "</div>"
    );
  }

  marketDataEl.innerHTML = cards.length ? cards.join("") : '<div class="empty-state">هیچ منبع زنده‌ای پاسخ نداد.</div>';
  marketUpdatedEl.textContent = data.updatedAt ? "آخرین خواندن: " + formatDate(data.updatedAt) : "زمان دریافت نامشخص";
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
  return { stress, fixedReturn, changesAvailable: changes.length > 0 };
}

function calculateAllocation() {
  const signal = getSignal();
  let weights = { fixed: 66, gold: 22, currency: 9, silver: 3 };
  let note = "ترکیب پایه برای شروع آرام و منظم انتخاب شده است.";

  if (signal.stress >= 2) {
    weights = { fixed: 70, gold: 20, currency: 8, silver: 2 };
    note = "به‌خاطر نوسان بالاتر داده‌های بازار، سهم بخش دفاعی کمی بیشتر شده؛ خریدهای طلا و ارز همچنان پله‌ای بمانند.";
  } else if (signal.stress > 0 && signal.stress < 0.7) {
    weights = { fixed: 64, gold: 23, currency: 10, silver: 3 };
    note = "نوسان روزانه فعلا شدید نیست؛ وزن دارایی‌های پوشش‌دهنده کمی بیشتر شده، اما ساختار سبد محافظه‌کارانه مانده است.";
  }

  if (Number.isFinite(signal.fixedReturn) && signal.fixedReturn < 25) {
    weights.fixed += 1;
    weights.gold -= 1;
    note += " بازده منتشرشده درآمد ثابت هم در تنظیم وزن بررسی شده است.";
  }
  return { weights, note, stress: signal.stress };
}

function renderAllocation(salary, rate) {
  const total = salary * rate / 100;
  const result = calculateAllocation();
  $("#total-investment").textContent = formatIRR(total);
  $("#total-rate").textContent = formatPercent(rate);
  $("#recommendation-mood").textContent = result.stress >= 2 ? "کمی دفاعی‌تر" : "دفاعی و متعادل";
  $("#model-note-text").textContent = result.note;

  allocationList.innerHTML = Object.keys(result.weights).map((key) => {
    const weight = result.weights[key];
    const amount = total * weight / 100;
    const meta = assetMeta[key];
    return (
      '<div class="allocation-item">' +
        '<div><div class="allocation-title"><span class="asset-dot ' + meta.dotClass + '"></span>' + meta.title + "</div>" +
        '<p class="allocation-desc">' + meta.description + "</p></div>" +
        '<div class="allocation-meta"><span class="allocation-percent">' + formatPercent(weight) + '</span><span class="allocation-amount">' + formatIRR(amount) + " ریال</span></div>" +
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
    historyList.innerHTML = '<div class="empty-state">هنوز پیشنهادی ثبت نشده. اولین ماه را از بالا شروع کن.</div>';
    return;
  }
  historyList.innerHTML = history.slice(0, 8).map((item) =>
    '<div class="history-item"><span class="history-date">' + formatDate(item.createdAt) + " · " + formatPercent(item.rate) + '</span><span class="history-total">' + formatIRR(item.total) + ' <small>ریال</small></span></div>'
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
  setStatus("در حال خواندن داده‌ها…", "loading");
  marketDataEl.innerHTML = '<div class="loading-lines"><span></span><span></span><span></span><span></span></div>';
  try {
    const response = await fetch("/api/market", { cache: "no-store" });
    if (!response.ok) throw new Error("market request failed");
    const data = await response.json();
    liveMarket = data;
    cacheMarket(data);
    renderMarket(data);
    setStatus("داده زنده وصل است", "success");
  } catch {
    liveMarket = readCachedMarket();
    renderMarket(liveMarket);
    setStatus(liveMarket ? "آخرین داده ذخیره‌شده" : "داده زنده در دسترس نیست", "warning");
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const salary = numberFromInput(salaryInput.value);
  const rate = Math.min(25, Math.max(15, Number(rateInput.value) || 20));
  if (!salary || salary <= 0) {
    salaryInput.focus();
    salaryInput.setCustomValidity("حقوق ماهانه را وارد کن.");
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

updateRateOutput();
renderHistory();
loadMarket();