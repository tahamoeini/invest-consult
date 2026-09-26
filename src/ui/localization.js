// @ts-check

const PERSIAN_TEXT = /[\u0600-\u06ff]/;
const WORD_CHARACTER = "[\\p{L}\\p{M}\\p{N}\\u200c\\u200d]";

export function translateCopy(value, phrases = {}) {
  if (typeof value !== "string") return value;
  if (Object.hasOwn(phrases, value)) return phrases[value];
  return Object.keys(phrases)
    .filter((phrase) => phrase)
    .sort((left, right) => right.length - left.length)
    .reduce((result, phrase) => {
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const before = PERSIAN_TEXT.test(phrase[0]) ? `(?<!${WORD_CHARACTER})` : "";
      const after = PERSIAN_TEXT.test(phrase[phrase.length - 1]) ? `(?!${WORD_CHARACTER})` : "";
      return result.replace(new RegExp(`${before}${escaped}${after}`, "gu"), phrases[phrase]);
    }, value);
}

export function mergeCopyCatalog(base, localized) {
  if (!base || typeof base !== "object" || Array.isArray(base)) return localized ?? base;
  const result = { ...base };
  Object.entries(localized && typeof localized === "object" ? localized : {}).forEach(([key, value]) => {
    result[key] =
      value && typeof value === "object" && !Array.isArray(value) ? mergeCopyCatalog(base[key], value) : value;
  });
  return result;
}

export function copyPhraseMap(base, localized) {
  const phrases = {};
  const visit = (source, translated) => {
    if (typeof source === "string" && typeof translated === "string") {
      if (PERSIAN_TEXT.test(source) && source !== translated && !PERSIAN_TEXT.test(translated))
        phrases[source] = translated;
      return;
    }
    if (!source || !translated || typeof source !== "object" || typeof translated !== "object") return;
    Object.keys(source).forEach((key) => visit(source[key], translated[key]));
  };
  visit(base, localized);
  return phrases;
}

export function createLocalizedCatalog(base, localized) {
  const catalog = mergeCopyCatalog(base, localized);
  catalog.phrases = {
    ...copyPhraseMap(base, localized),
    ...(localized?.phrases || {}),
  };
  return catalog;
}
