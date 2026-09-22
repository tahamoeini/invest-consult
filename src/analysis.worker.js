import { runAnalysisTask } from "./analysis.js";

self.addEventListener("message", (event) => {
  const { requestId, task } = event.data || {};
  try {
    self.postMessage({ requestId, result: runAnalysisTask(task) });
  } catch (error) {
    self.postMessage({ requestId, error: error instanceof Error ? error.message : "analysis-failed" });
  }
});
