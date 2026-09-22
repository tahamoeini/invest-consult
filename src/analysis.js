import {
  DEFAULT_ASSUMPTIONS,
  backtestHistorical,
  estimateReturnModel,
  evaluateGoal,
  runMonteCarlo,
  simulatePlan,
  walkForwardValidation,
} from "./engine.js";

export function runAnalysisTask(task) {
  const options = task?.options || {};
  if (task?.type === "backtest") return backtestHistorical(options);
  if (task?.type === "goal") return evaluateGoal(options);
  if (task?.type !== "plan-analysis") throw new Error("unknown-analysis-task");

  const modelResult = estimateReturnModel(options.market || {}, options.assumptions || DEFAULT_ASSUMPTIONS);
  const validation = walkForwardValidation(options.market || {}, options.assumptions || DEFAULT_ASSUMPTIONS);
  const method = validation.bootstrapEligible ? "block-bootstrap" : validation.ewmaEligible ? "ewma" : "gaussian";
  const simulation = simulatePlan({ ...options, annualReturns: modelResult.model });
  const monteCarlo = runMonteCarlo({
    ...options,
    returnModel: modelResult.model,
    ewmaModel: modelResult.ewmaModel,
    historical: modelResult.historical,
    covariance: modelResult.covariance,
    referenceAnnualReturn: modelResult.referenceAnnualReturn,
    method,
  });
  return { simulation, monteCarlo, modelResult, validation };
}
