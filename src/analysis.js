import {
  DEFAULT_ASSUMPTIONS,
  backtestHistorical,
  estimateReturnModel,
  evaluateGoal,
  MIN_PAIRED_MONTHS,
  runMonteCarlo,
  simulatePlan,
  normalizeAllocation,
  walkForwardValidation,
} from "./engine.js";

export function runAnalysisTask(task) {
  const options = task?.options || {};
  if (task?.type === "backtest") return backtestHistorical(options);
  if (task?.type === "goal") return evaluateGoal(options);
  if (task?.type !== "plan-analysis") throw new Error("unknown-analysis-task");

  const modelResult = estimateReturnModel(options.market || {}, options.assumptions || DEFAULT_ASSUMPTIONS);
  const validation = walkForwardValidation(options.market || {}, options.assumptions || DEFAULT_ASSUMPTIONS);
  const allocation = normalizeAllocation(options.allocation);
  const selectedHistoricalAssets = Object.keys(allocation).filter(
    (asset) => asset !== "fixed" && allocation[asset] > 0,
  );
  const completeRows = modelResult.historical.rows.filter(
    (row) =>
      selectedHistoricalAssets.length > 0 &&
      selectedHistoricalAssets.every((asset) => row.observed?.[asset] && Number.isFinite(row.returns?.[asset])),
  );
  let longestJointRun = 0;
  let jointRun = 0;
  let previousMonth = null;
  completeRows.forEach((row) => {
    const [year, month] = row.month.split("-").map(Number);
    const ordinal = year * 12 + month;
    jointRun = previousMonth === null || ordinal === previousMonth + 1 ? jointRun + 1 : 1;
    longestJointRun = Math.max(longestJointRun, jointRun);
    previousMonth = ordinal;
  });
  const hasJointHistory =
    selectedHistoricalAssets.length > 0 &&
    selectedHistoricalAssets.every(
      (asset) => (modelResult.historical.assetMetadata?.[asset]?.returnObservations || 0) >= MIN_PAIRED_MONTHS,
    ) &&
    longestJointRun >= MIN_PAIRED_MONTHS;
  const bootstrapValidated =
    hasJointHistory && selectedHistoricalAssets.every((asset) => validation.diagnostics[asset]?.bootstrapEligible);
  const ewmaValidated =
    selectedHistoricalAssets.length > 0 &&
    selectedHistoricalAssets.every((asset) => validation.diagnostics[asset]?.ewmaEligible);
  const method = bootstrapValidated ? "block-bootstrap" : ewmaValidated ? "ewma" : "gaussian";
  const simulation = simulatePlan({
    ...options,
    annualReturns: modelResult.model,
    currentFixedAnnualReturn: options.currentFixedAnnualReturn ?? modelResult.referenceAnnualReturn,
  });
  const monteCarloOptions = {
    ...options,
    returnModel: modelResult.model,
    ewmaModel: modelResult.ewmaModel,
    historical: modelResult.historical,
    covariance: modelResult.covariance,
    referenceAnnualReturn: modelResult.referenceAnnualReturn,
    method,
  };
  const monteCarlo = runMonteCarlo(monteCarloOptions);
  const comparisonSeed = (Number.isFinite(Number(options.seed)) ? Number(options.seed) : 42) + 1;
  const comparisonBase = Object.fromEntries(Object.entries(monteCarloOptions).filter(([key]) => key !== "random"));
  const gaussian =
    method === "gaussian" ? monteCarlo : runMonteCarlo({ ...comparisonBase, method: "gaussian", seed: comparisonSeed });
  const bootstrap =
    hasJointHistory && method === "block-bootstrap"
      ? monteCarlo
      : hasJointHistory
        ? runMonteCarlo({ ...comparisonBase, method: "block-bootstrap", seed: comparisonSeed })
        : null;
  const methodComparison = {
    available: Boolean(bootstrap),
    explanation: bootstrap ? "paired-observed-monthly-history" : "insufficient-complete-joint-history",
    gaussian: { nominal: gaussian.nominal, real: gaussian.real },
    bootstrap: bootstrap ? { nominal: bootstrap.nominal, real: bootstrap.real } : null,
  };
  return { simulation, monteCarlo, modelResult, validation, methodComparison };
}
