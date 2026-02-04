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

import { writeFileSync } from "node:fs";

export const permissionsHandlers: GatewayRequestHandlers = {
  "permissions.killSwitch": ({ respond }) => {
    const config = loadConfig();
    if (!config) {
      respond(false, undefined, { code: -1, message: "Not configured" });
      return;
    }
    // Disable auto-run
    config.autonomy.autoRun = false;
    try {
      const p = join(workspacePath(), "permissions.json");
      writeFileSync(p, JSON.stringify(config, null, 2) + "\n");

      // Kill active swarm workers
      const { execSync } = require("node:child_process");
      try {
        execSync("pkill -f 'swarm/' || true", { timeout: 5000, stdio: "ignore" });
      } catch {}

      // Write kill marker for heartbeat to see
      writeFileSync(join(workspacePath(), ".kill-switch"), new Date().toISOString());

      respond(true, { killed: true, autoRun: false, message: "All activity stopped. Auto-run disabled." });
    } catch (err) {
      respond(false, undefined, { code: -1, message: String(err) });
    }
  },


  "permissions.toggleAutoRun": ({ params, respond }) => {
    const config = loadConfig();
    if (!config) {
      respond(false, undefined, { code: -1, message: "Not configured" });
      return;
    }
    const { enabled } = params as { enabled?: boolean };
    config.autonomy.autoRun = enabled ?? !config.autonomy.autoRun;
    try {
      const p = join(workspacePath(), "permissions.json");
      writeFileSync(p, JSON.stringify(config, null, 2) + "\n");
      // Clear kill switch if re-enabling
      if (config.autonomy.autoRun) {
        const killPath = join(workspacePath(), ".kill-switch");
        try { require("node:fs").unlinkSync(killPath); } catch {}
      }
      respond(true, { autoRun: config.autonomy.autoRun });
    } catch (err) {
      respond(false, undefined, { code: -1, message: String(err) });
    }
  },

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
      autoRun: config.autonomy?.autoRun ?? false,
      granted: granted.sort(),
      denied: denied.sort(),
      totalGranted: granted.length,
      totalDenied: denied.length,
      escalation: config.escalation || {},
      configured: true,
    });
  },

  /** Recent permission audit entries from the DB. */
  "permissions.audit": ({ params, respond }) => {
    try {
      const { getTasksDb } = require("./tasks-db.js");
      const db = getTasksDb();
      if (!db) {
        respond(true, { entries: [], hasDb: false });
        return;
      }
      const limit = (params as { limit?: number }).limit || 20;
      const rows = db.prepare(
        "SELECT ts, capability, granted, level, role, context FROM permission_audit ORDER BY ts DESC LIMIT ?"
      ).all(limit) as Array<{ ts: string; capability: string; granted: number; level: number; role: string; context: string }>;
      respond(true, {
        entries: rows.map((r) => ({
          ts: r.ts,
          capability: r.capability,
          granted: !!r.granted,
          level: r.level,
          role: r.role,
          context: r.context,
        })),
        hasDb: true,
      });
    } catch (err) {
      respond(false, undefined, { code: -1, message: String(err) });
    }
  },
};
