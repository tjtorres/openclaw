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

/** Find a workspace script by name. */
function findScript(name: string): string | null {
  const candidates = [
    resolve(process.env.HOME || "", `.openclaw/workspace/scripts/${name}`),
    resolve(process.cwd(), `scripts/${name}`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/** Run a Python script and return parsed JSON. */
function runScript(scriptName: string, args: string[]): unknown {
  const script = findScript(scriptName);
  if (!script) {
    throw new Error(`${scriptName} not found in workspace`);
  }
  const escaped = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
  const result = execSync(`python3 '${script}' ${escaped}`, {
    encoding: "utf-8",
    timeout: 15_000,
    cwd: dirname(script),
  });
  return JSON.parse(result.trim());
}

/** Shorthand for cost_estimator.py */
function runEstimator(args: string[]): unknown {
  return runScript("cost_estimator.py", args);
}

/** Shorthand for model_router.py */
function runRouter(args: string[]): unknown {
  return runScript("model_router.py", args);
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

  // ── Model Router ──────────────────────────────────────────────────

  /** Recommend optimal model for a task. */
  "router.recommend": async ({ params, respond }) => {
    try {
      const { description, optimize } = params as {
        description?: string;
        optimize?: string;
      };
      if (!description) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "description required"));
        return;
      }
      const args = ["recommend", description];
      if (optimize) args.push("--optimize", optimize);
      const result = runRouter(args);
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, String(err)));
    }
  },

  /** Get the full model scoring matrix. */
  "router.matrix": async ({ params, respond }) => {
    try {
      const result = runRouter(["matrix"]);
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, String(err)));
    }
  },

  /** Classify a task description (complexity + type). */
  "router.classify": async ({ params, respond }) => {
    try {
      const { description } = params as { description?: string };
      const result = runRouter(["classify", description || ""]);
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, String(err)));
    }
  },

  /** Get router recommendation history. */
  "router.history": async ({ params, respond }) => {
    try {
      const { limit } = params as { limit?: number };
      const result = runRouter(["history", String(limit || 20)]);
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, String(err)));
    }
  },
};
