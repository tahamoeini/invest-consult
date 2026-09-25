// Stable strategy categories stay separate from instruments that carry quotes.
export const SLEEVE_REGISTRY = Object.freeze({
  liquidity: Object.freeze({ id: "liquidity", titleKey: "liquidity", recommendationEligible: false }),
  fixedIncome: Object.freeze({ id: "fixedIncome", titleKey: "fixedIncome", recommendationEligible: true }),
  gold: Object.freeze({ id: "gold", titleKey: "gold", recommendationEligible: true }),
  fx: Object.freeze({ id: "fx", titleKey: "fx", recommendationEligible: true }),
  iranEquity: Object.freeze({ id: "iranEquity", titleKey: "iranEquity", recommendationEligible: false }),
  globalEquity: Object.freeze({ id: "globalEquity", titleKey: "globalEquity", recommendationEligible: false }),
  crypto: Object.freeze({ id: "crypto", titleKey: "crypto", recommendationEligible: true }),
  commodities: Object.freeze({ id: "commodities", titleKey: "commodities", recommendationEligible: true }),
});

export const INSTRUMENT_REGISTRY = Object.freeze({
  dollar: Object.freeze({
    id: "dollar",
    sleeveId: "fx",
    marketKey: "dollar",
    unit: "TOMAN",
    quoteType: "direct",
    recommendationAssetId: "currency",
  }),
  gold: Object.freeze({
    id: "gold",
    sleeveId: "gold",
    marketKey: "gold",
    unit: "gram",
    quoteType: "direct",
    recommendationAssetId: "gold",
  }),
  silver: Object.freeze({
    id: "silver",
    sleeveId: "commodities",
    marketKey: "silver",
    unit: "gram",
    quoteType: "direct",
    recommendationAssetId: "silver",
  }),
  bitcoin: Object.freeze({
    id: "bitcoin",
    sleeveId: "crypto",
    marketKey: "bitcoin",
    unit: "coin",
    quoteType: "derived",
    recommendationOptional: true,
  }),
  ethereum: Object.freeze({
    id: "ethereum",
    sleeveId: "crypto",
    marketKey: "ethereum",
    unit: "coin",
    quoteType: "derived",
    recommendationOptional: true,
  }),
  tether: Object.freeze({
    id: "tether",
    sleeveId: "crypto",
    marketKey: "tether",
    unit: "coin",
    quoteType: "derived",
    simulationOnly: true,
  }),
  platinum: Object.freeze({
    id: "platinum",
    sleeveId: "commodities",
    marketKey: "platinum",
    unit: "gram",
    quoteType: "derived",
    recommendationOptional: true,
  }),
  palladium: Object.freeze({
    id: "palladium",
    sleeveId: "commodities",
    marketKey: "palladium",
    unit: "gram",
    quoteType: "derived",
    recommendationOptional: true,
  }),
  copper: Object.freeze({
    id: "copper",
    sleeveId: "commodities",
    marketKey: "copper",
    unit: "gram",
    quoteType: "derived",
    recommendationOptional: true,
  }),
  bourseIndex: Object.freeze({
    id: "bourseIndex",
    sleeveId: "iranEquity",
    marketKey: "bourseIndex",
    unit: "point",
    quoteType: "direct",
    tradable: false,
  }),
});

export const PLANNING_ASSET_TO_SLEEVE = Object.freeze({
  fixed: "fixedIncome",
  gold: "gold",
  currency: "fx",
  silver: "commodities",
  bitcoin: "crypto",
  ethereum: "crypto",
  platinum: "commodities",
  palladium: "commodities",
  copper: "commodities",
});

export const PLAN_ASSET_KEYS = Object.freeze(Object.keys(PLANNING_ASSET_TO_SLEEVE));
export const SIMULATION_ASSET_KEYS = Object.freeze([
  ...PLAN_ASSET_KEYS,
  ...Object.entries(INSTRUMENT_REGISTRY)
    .filter(([, instrument]) => instrument.simulationOnly && instrument.tradable !== false)
    .map(([instrumentId]) => instrumentId),
]);
export const CORE_PLAN_ASSET_KEYS = Object.freeze(["fixed", "gold", "currency", "silver"]);
export const OPTIONAL_RECOMMENDATION_ASSETS = Object.freeze(
  Object.entries(INSTRUMENT_REGISTRY)
    .filter(([, instrument]) => instrument.recommendationOptional && instrument.tradable !== false)
    .map(([instrumentId]) => instrumentId),
);

export function instrumentForAsset(assetId) {
  return INSTRUMENT_REGISTRY[assetId] || null;
}

export function sleeveForInstrument(instrumentId) {
  return INSTRUMENT_REGISTRY[instrumentId]?.sleeveId || null;
}
