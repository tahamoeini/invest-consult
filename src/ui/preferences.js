export const UI_PREFERENCES_KEY = "synthora-ui-preferences-v1";

export const LOCALES = Object.freeze({
  fa: { language: "fa", direction: "rtl", numberLocale: "fa-IR", defaultCurrency: "TOMAN" },
  en: { language: "en", direction: "ltr", numberLocale: "en-US", defaultCurrency: "USD" },
  ru: { language: "ru", direction: "ltr", numberLocale: "ru-RU", defaultCurrency: "RUB" },
  zh: { language: "zh-CN", direction: "ltr", numberLocale: "zh-CN", defaultCurrency: "CNY" },
});

const CURRENCIES = new Set(["TOMAN", "USD", "RUB", "CNY"]);
const THEMES = new Set(["system", "light", "dark"]);

export function readUiPreferences(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(UI_PREFERENCES_KEY) || "{}");
    const locale = Object.hasOwn(LOCALES, saved.locale) ? saved.locale : "fa";
    return {
      locale,
      currency: CURRENCIES.has(saved.currency) ? saved.currency : null,
      theme: THEMES.has(saved.theme) ? saved.theme : "system",
    };
  } catch {
    return { locale: "fa", currency: null, theme: "system" };
  }
}

export function writeUiPreferences(preferences, storage = globalThis.localStorage) {
  const locale = Object.hasOwn(LOCALES, preferences?.locale) ? preferences.locale : "fa";
  const currency = CURRENCIES.has(preferences?.currency) ? preferences.currency : null;
  const theme = THEMES.has(preferences?.theme) ? preferences.theme : "system";
  try {
    storage.setItem(UI_PREFERENCES_KEY, JSON.stringify({ locale, currency, theme }));
    return { locale, currency, theme };
  } catch {
    return { locale, currency, theme };
  }
}

export function preferredCurrency(preferences = readUiPreferences()) {
  return preferences.currency || LOCALES[preferences.locale]?.defaultCurrency || "TOMAN";
}

export function resolveTheme(theme, systemIsDark = false) {
  if (theme === "light" || theme === "dark") return theme;
  return systemIsDark ? "dark" : "light";
}

export function applyUiPreferences(preferences, documentRef = globalThis.document, windowRef = globalThis.window) {
  if (!documentRef?.documentElement) return;
  const locale = LOCALES[preferences?.locale] ? preferences.locale : "fa";
  const localeConfig = LOCALES[locale];
  const systemIsDark = Boolean(windowRef?.matchMedia?.("(prefers-color-scheme: dark)").matches);
  documentRef.documentElement.lang = localeConfig.language;
  documentRef.documentElement.dir = localeConfig.direction;
  documentRef.documentElement.dataset.theme = resolveTheme(preferences?.theme, systemIsDark);
  documentRef.documentElement.dataset.locale = locale;
  const themeColor = documentRef.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = documentRef.documentElement.dataset.theme === "dark" ? "#10191f" : "#102b36";
}

export function displayCurrencyValue(tomanValue, currency, fxQuotes = {}) {
  const amount = Number(tomanValue);
  if (!Number.isFinite(amount)) return null;
  if (currency === "TOMAN") return { amount, currency, converted: false };
  const quote = fxQuotes[currency];
  const rate = Number(quote?.rate);
  if (!Number.isFinite(rate) || rate <= 0 || quote?.status === "unavailable") return null;
  return { amount: amount * rate, currency, converted: true, quote };
}
