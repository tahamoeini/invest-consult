function observationTime(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric =
    typeof value === "number" || (typeof value === "string" && /^\d{10,13}$/.test(value.trim())) ? Number(value) : null;
  const date = numeric === null ? new Date(value) : new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function addCandidate(candidates, candidate, source) {
  const price = Number(candidate?.price ?? candidate?.value ?? candidate?.close);
  const observedAt = observationTime(
    candidate?.observedAt || candidate?.asOf || candidate?.date || candidate?.time || candidate?.timestamp,
  );
  if (!Number.isFinite(price) || price <= 0 || !observedAt || candidate?.status === "conflicted") return;
  candidates.push({
    price,
    observedAt,
    source: candidate?.source || source || null,
    unit: candidate?.unit || null,
  });
}

/** Resolve a timestamped prior quote for display only; callers must keep it outside market.assets. */
export function lastKnownMarketQuote(assetId, currentMarket, cachedMarket, now = Date.now()) {
  const candidates = [];
  const currentItem = currentMarket?.assets?.[assetId];
  const cachedItem = cachedMarket?.assets?.[assetId];
  const currentResponseExists =
    Boolean(currentMarket?.diagnostics) || Object.keys(currentMarket?.assets || {}).length > 0;
  const cutoff =
    currentResponseExists && observationTime(currentMarket?.updatedAt)
      ? observationTime(currentMarket.updatedAt)
      : new Date(now).toISOString();
  const cutoffTime = new Date(cutoff).getTime();

  const history = currentMarket?.history?.[assetId];
  if (Array.isArray(history)) history.forEach((point) => addCandidate(candidates, point, ""));
  addCandidate(candidates, cachedItem, "");

  return (
    candidates
      .filter((candidate) => new Date(candidate.observedAt).getTime() < cutoffTime)
      .sort((left, right) => new Date(right.observedAt).getTime() - new Date(left.observedAt).getTime())
      .map((candidate) => ({
        ...candidate,
        unit: candidate.unit || currentItem?.unit || cachedItem?.unit || null,
      }))[0] || null
  );
}
