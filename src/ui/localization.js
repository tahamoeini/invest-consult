// @ts-check

const PERSIAN_TEXT = /[\u0600-\u06ff]/;

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
