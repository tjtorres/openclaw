/**
 * Cost estimation & tracking RPC handlers.
 *
 * Provides a priori cost estimates for tasks, tracks actual costs,
 * and supports recalibration based on historical data.
 */
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

/** Find the cost estimator script relative to workspace. */
function findEstimator(): string | null {
  // Check common locations
  const candidates = [
    resolve(process.env.HOME || "", ".openclaw/workspace/scripts/cost_estimator.py"),
    resolve(process.cwd(), "scripts/cost_estimator.py"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/** Run the cost estimator Python script and return parsed JSON. */
function runEstimator(args: string[]): unknown {
  const script = findEstimator();
  if (!script) {
    throw new Error("cost_estimator.py not found in workspace");
  }
  const escaped = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
  const result = execSync(`python3 '${script}' ${escaped}`, {
    encoding: "utf-8",
    timeout: 15_000,
    cwd: dirname(script),
  });
  return JSON.parse(result.trim());
}

export const costsHandlers: GatewayRequestHandlers = {

  /** Estimate cost for a task description. */
  "costs.estimate": async ({ params, respond }) => {
    try {
      const { description, model, complexity } = params as {
        description?: string;
        model?: string;
        complexity?: string;
      };
      if (!description) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "description required"));
        return;
      }
      const args = ["estimate", description];
      if (model) args.push(model);
      const result = runEstimator(args);
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, String(err)));
    }
  },

  /** Estimate cost across all models for comparison. */
  "costs.estimateAll": async ({ params, respond }) => {
    try {
      const { description } = params as { description?: string };
      if (!description) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "description required"));
        return;
      }
      const result = runEstimator(["estimate-all", description]);
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, String(err)));
    }
  },

  /** Classify task complexity from description. */
  "costs.classify": async ({ params, respond }) => {
    try {
      const { description } = params as { description?: string };
      const result = runEstimator(["classify", description || ""]);
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, String(err)));
    }
  },

  /** Save cost estimate for a specific card. */
  "costs.saveEstimate": async ({ params, respond }) => {
    try {
      const { cardId, cardName, description, model } = params as {
        cardId?: string;
        cardName?: string;
        description?: string;
        model?: string;
      };
      if (!cardId || !cardName || !description) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cardId, cardName, and description required"));
        return;
      }
      const args = ["save", cardId, cardName, description];
      if (model) args.push(model);
      const result = runEstimator(args);
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, String(err)));
    }
  },

  /** Compare estimated vs actual cost for a card. */
  "costs.compare": async ({ params, respond }) => {
    try {
      const { cardId } = params as { cardId?: string };
      if (!cardId) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cardId required"));
        return;
      }
      const result = runEstimator(["compare", cardId]);
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, String(err)));
    }
  },

  /** Recalibrate estimates from completed tasks. */
  "costs.calibrate": async ({ params, respond }) => {
    try {
      const result = runEstimator(["calibrate"]);
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, String(err)));
    }
  },

  /** Get overall cost tracking summary. */
  "costs.summary": async ({ params, respond }) => {
    try {
      const result = runEstimator(["summary"]);
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, String(err)));
    }
  },
};
