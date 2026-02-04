/**
 * Permissions RPCs — expose autonomy level, role, and capabilities to the dashboard.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { GatewayRequestHandlers } from "./types.js";
import { workspacePath } from "./tasks-db.js";

type PermissionsConfig = {
  autonomy: {
    level: number;
    levelName: string;
    approvedEpochs: string[];
    budgetPerDay: number;
    budgetPerSprint: number;
  };
  role: string;
  capabilities: Record<string, Record<string, boolean>>;
  escalation: Record<string, string>;
};

const LEVEL_NAMES: Record<number, string> = {
  1: "IC",
  2: "Tech Lead",
  3: "Manager",
  4: "Director",
  5: "VP",
};

function loadConfig(): PermissionsConfig | null {
  try {
    const p = join(workspacePath(), "permissions.json");
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

export const permissionsHandlers: GatewayRequestHandlers = {
  "permissions.summary": ({ respond }) => {
    const config = loadConfig();
    if (!config) {
      respond(true, {
        level: 1, levelName: "IC", levelLabel: "L1 IC",
        role: "assistant", approvedEpochs: [],
        budgetPerDay: 0, budgetPerSprint: 0,
        granted: [], denied: [], totalGranted: 0, totalDenied: 0,
        configured: false,
      });
      return;
    }

    const granted: string[] = [];
    const denied: string[] = [];
    for (const [domain, actions] of Object.entries(config.capabilities || {})) {
      for (const [action, value] of Object.entries(actions)) {
        (value ? granted : denied).push(`${domain}.${action}`);
      }
    }

    const level = config.autonomy?.level ?? 1;
    respond(true, {
      level,
      levelName: LEVEL_NAMES[level] || "Unknown",
      levelLabel: `L${level} ${LEVEL_NAMES[level] || ""}`.trim(),
      role: config.role || "assistant",
      approvedEpochs: config.autonomy?.approvedEpochs || [],
      budgetPerDay: config.autonomy?.budgetPerDay || 0,
      budgetPerSprint: config.autonomy?.budgetPerSprint || 0,
      granted: granted.sort(),
      denied: denied.sort(),
      totalGranted: granted.length,
      totalDenied: denied.length,
      escalation: config.escalation || {},
      configured: true,
    });
  },
};
