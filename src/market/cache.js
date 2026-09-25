export function marketCacheAge(market, now = Date.now()) {
  if (!market || typeof market !== "object" || Array.isArray(market)) return Infinity;
  const updatedAt = Date.parse(market.updatedAt || "");
  return Number.isFinite(updatedAt) ? now - updatedAt : Infinity;
}
