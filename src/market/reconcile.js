import { median } from "../engine.js";

export function reconcileMarketWithRecentAcceptedQuote(market, previousMarket, now = Date.now()) {
  if (!market?.assets || !previousMarket?.assets) return market;
  const previous = previousMarket.assets;
  const next = { ...market, assets: { ...market.assets } };
  Object.entries(next.assets).forEach(([assetId, item]) => {
    const prior = previous[assetId];
    const priorPrice = Number(prior?.price);
    const priorTime = new Date(prior?.observedAt || prior?.asOf || "").getTime();
    const needsReconciliation = item?.status === "conflicted" || item?.consensusDisagreement === true;
    if (!needsReconciliation || !(priorPrice > 0) || !Number.isFinite(priorTime) || prior.status === "conflicted")
      return;
    const sourceValues = Array.isArray(item.sourceValues) ? item.sourceValues : [];
    const currentTimes = sourceValues
      .map((source) => new Date(source.observedAt || "").getTime())
      .filter(Number.isFinite);
    if (!currentTimes.length) return;
    const latestTime = Math.max(...currentTimes);
    const ageLimit = ["bitcoin", "ethereum", "tether"].includes(assetId) ? 15 * 60_000 : 3 * 60 * 60_000;
    if (now - priorTime > ageLimit || latestTime < priorTime || latestTime - priorTime > ageLimit) return;
    const tolerance =
      assetId === "dollar"
        ? 0.02
        : ["bitcoin", "ethereum", "tether"].includes(assetId)
          ? 0.1
          : assetId === "gold"
            ? 0.04
            : 0.08;
    const observationWindow = ["bitcoin", "ethereum", "tether"].includes(assetId)
      ? 5 * 60_000
      : assetId === "dollar"
        ? 60 * 60_000
        : 30 * 60_000;
    const aligned = sourceValues.filter((source) => {
      const observedTime = new Date(source.observedAt || "").getTime();
      return (
        Number.isFinite(observedTime) &&
        observedTime >= priorTime &&
        latestTime - observedTime <= observationWindow &&
        Number(source.price) > 0 &&
        Math.abs(Number(source.price) / priorPrice - 1) <= tolerance
      );
    });
    if (!aligned.length) return;
    const price = median(aligned.map((source) => Number(source.price)));
    const acceptedSources = new Set(aligned.map((source) => source.source));
    const observedAt = new Date(
      Math.max(...aligned.map((source) => new Date(source.observedAt).getTime())),
    ).toISOString();
    next.assets[assetId] = {
      ...item,
      price: Math.round(price),
      status: "degraded",
      confidence: "low",
      consensusDisagreement: true,
      consensusMethod: "recent-anchor-median",
      sourceCount: aligned.length,
      sources: [...acceptedSources],
      observedAt,
      asOf: observedAt,
      reconciliationNote: "منابع تازه اختلاف داشتند؛ میانه‌ی نرخ‌های نزدیک به آخرین مقدار پذیرفته‌شده مبنا شد.",
      sourceValues: sourceValues.map((source) => ({ ...source, accepted: acceptedSources.has(source.source) })),
    };
  });

  const previousDollarPrice = Number(market.assets.dollar?.price);
  const dollar = next.assets.dollar;
  if (!dollar?.reconciliationNote || !(previousDollarPrice > 0) || !(Number(dollar.price) > 0)) return next;
  const scale = Number(dollar.price) / previousDollarPrice;
  Object.entries(next.assets).forEach(([assetId, item]) => {
    if (
      assetId === "dollar" ||
      item?.quoteType !== "derived" ||
      !Array.isArray(item.derivedFrom) ||
      !item.derivedFrom.includes("USD/TOMAN")
    )
      return;
    next.assets[assetId] = {
      ...item,
      price: Math.round(Number(item.price) * scale),
      sourceValues: Array.isArray(item.sourceValues)
        ? item.sourceValues.map((source) => ({ ...source, price: Math.round(Number(source.price) * scale) }))
        : item.sourceValues,
      dependencies: Array.isArray(item.dependencies)
        ? item.dependencies.map((dependency) =>
            dependency.instrumentId === "dollar"
              ? {
                  ...dependency,
                  price: Number(dollar.price),
                  sourceCount: Number(dollar.sourceCount) || 0,
                  source: (dollar.sources || []).join(", "),
                  status: dollar.status,
                  confidence: dollar.confidence,
                  observedAt: dollar.observedAt || null,
                  retrievedAt: dollar.retrievedAt || market.updatedAt || null,
                }
              : dependency,
          )
        : item.dependencies,
    };
  });
  return next;
}
