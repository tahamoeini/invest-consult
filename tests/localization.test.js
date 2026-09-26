import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLocalizedCatalog, translateCopy } from "../src/ui/localization.js";

function readCatalog(locale) {
  return JSON.parse(readFileSync(new URL("../content/" + locale + ".json", import.meta.url), "utf8"));
}

function assertCatalogCoverage(base, localized, path = "root") {
  for (const [key, value] of Object.entries(base)) {
    if (key === "phrases") continue;
    assert.ok(Object.hasOwn(localized, key), path + "." + key + " is missing");
    if (value && typeof value === "object" && !Array.isArray(value))
      assertCatalogCoverage(value, localized[key], path + "." + key);
  }
}

test("each static locale catalog inherits the complete Persian base key shape", () => {
  const base = readCatalog("fa");
  for (const locale of ["en", "ru", "zh"]) {
    const source = readCatalog(locale);
    const merged = createLocalizedCatalog(base, source);
    assertCatalogCoverage(base, merged);
    assert.equal(merged.pageTitle, source.pageTitle);
  }
});

test("portfolio, reference, and appearance controls have reviewed static translations", () => {
  for (const locale of ["en", "ru", "zh"]) {
    const catalog = createLocalizedCatalog(readCatalog("fa"), readCatalog(locale));
    for (const key of [
      "portfolio.tomanBasisNote",
      "portfolio.displayCurrencyNote",
      "portfolio.fxUnavailableNote",
      "portfolio.fxStaleNote",
      "portfolio.contributionChart",
      "portfolio.noContributionHistory",
      "portfolio.holdingCount",
      "portfolio.noTarget",
      "portfolio.disputedPrice",
      "portfolio.missingPrice",
      "portfolio.manualPrice",
      "reference.title",
      "reference.note",
      "reference.source.cfets",
      "reference.source.cbr",
      "reference.source.metals",
    ]) {
      const value = key.split(".").reduce((current, part) => current?.[part], catalog);
      assert.equal(typeof value, "string", locale + " missing " + key);
      assert.ok(value.length > 0, locale + " has empty " + key);
    }
    for (const key of [
      "نمای فهرستی دارایی‌ها",
      "جستجوی دارایی",
      "وزن فعلی",
      "وزن هدف",
      "ارز نمایشی پرتفوی",
      "همگام با سیستم",
      "تیره",
    ]) {
      assert.ok(catalog.phrases[key], locale + " has no static translation for " + key);
    }
  }
});

test("phrase translation does not replace short words inside longer Persian words", () => {
  const phrases = { تا: "to", نسخه: "version", ماه: "month", "تاریخچه برنامه": "Plan history" };
  assert.equal(translateCopy("تاریخچه", phrases), "تاریخچه");
  assert.equal(translateCopy("نسخه‌های اخیر", phrases), "نسخه‌های اخیر");
  assert.equal(translateCopy("۳ ماه", phrases), "۳ month");
  assert.equal(translateCopy("ماه،", phrases), "month،");
  assert.equal(translateCopy("تاریخچه برنامه", phrases), "Plan history");
});
