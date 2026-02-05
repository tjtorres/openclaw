import fs from "node:fs/promises";
import path from "node:path";
import type { ChatRunRegistry } from "./server-chat.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("gateway/snapshot");

export type ActiveRunSnapshot = {
  version: 1;
  timestamp: number;
  runs: Array<{
    sessionKey: string;
    clientRunId: string;
    sessionId: string;
    seq?: number;
  }>;
};

export type ActiveRunsContext = {
  chatRunRegistry: ChatRunRegistry;
  agentRunSeq: Map<string, number>;
  resolveSessionKeyForRun: (runId: string) => string | undefined;
};

const SNAPSHOT_FILENAME = "active-runs.snapshot.json";

export function resolveSnapshotPath(workspaceDir: string): string {
  return path.join(workspaceDir, ".openclaw", SNAPSHOT_FILENAME);
}

/**
 * Save active runs snapshot to disk before shutdown.
 * This captures in-flight runs so they can be reconciled on next startup.
 */
export async function saveActiveRunsSnapshot(params: {
  workspaceDir: string;
  context: ActiveRunsContext;
}): Promise<void> {
  const { workspaceDir, context } = params;
  const snapshotPath = resolveSnapshotPath(workspaceDir);

  try {
    // Extract all active runs from the registry
    const runs: ActiveRunSnapshot["runs"] = [];

    // Iterate through all sessions and their runs
    for (const [sessionId, entries] of context.chatRunRegistry.entries()) {
      for (const entry of entries) {
        const seq = context.agentRunSeq.get(entry.clientRunId);
        runs.push({
          sessionKey: entry.sessionKey,
          clientRunId: entry.clientRunId,
          sessionId,
          seq,
        });
      }
    }

    const snapshot: ActiveRunSnapshot = {
      version: 1,
      timestamp: Date.now(),
      runs,
    };

    const snapshotDir = path.dirname(snapshotPath);
    await fs.mkdir(snapshotDir, { recursive: true });
    await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), {
      mode: 0o600,
      encoding: "utf-8",
    });

    if (runs.length > 0) {
      log.info(`saved ${runs.length} active run(s) to snapshot`);
    }
  } catch (err) {
    log.error(`failed to save active runs snapshot: ${err}`);
    // Don't throw - shutdown should proceed even if snapshot fails
  }
}

/**
 * Load active runs snapshot from disk on startup.
 * Returns the snapshot data if it exists and is valid, otherwise null.
 */
export async function loadActiveRunsSnapshot(params: {
  workspaceDir: string;
}): Promise<ActiveRunSnapshot | null> {
  const { workspaceDir } = params;
  const snapshotPath = resolveSnapshotPath(workspaceDir);

  try {
    const raw = await fs.readFile(snapshotPath, "utf-8");
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") {
      throw new Error("invalid snapshot format");
    }

    if (parsed.version !== 1) {
      throw new Error(`unsupported snapshot version: ${parsed.version}`);
    }

    if (!Array.isArray(parsed.runs)) {
      throw new Error("snapshot missing runs array");
    }

    return parsed as ActiveRunSnapshot;
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code === "ENOENT") {
      // No snapshot file - normal on first boot
      return null;
    }
    log.warn(`failed to load active runs snapshot: ${err}`);
    return null;
  }
}

/**
 * Delete the snapshot file after processing.
 */
export async function clearActiveRunsSnapshot(params: { workspaceDir: string }): Promise<void> {
  const { workspaceDir } = params;
  const snapshotPath = resolveSnapshotPath(workspaceDir);

  try {
    await fs.unlink(snapshotPath);
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code !== "ENOENT") {
      log.warn(`failed to clear snapshot: ${err}`);
    }
  }
}

/**
 * Reconcile active runs snapshot with current state on startup.
 * This checks for runs that were active when the gateway shut down
 * and ensures they are properly marked as interrupted.
 */
export async function reconcileActiveRunsSnapshot(params: {
  workspaceDir: string;
  storePath: string;
}): Promise<{ processedCount: number; interruptedCount: number }> {
  const { workspaceDir, storePath } = params;

  try {
    const snapshot = await loadActiveRunsSnapshot({ workspaceDir });

    if (!snapshot || snapshot.runs.length === 0) {
      return { processedCount: 0, interruptedCount: 0 };
    }

    const ageMs = Date.now() - snapshot.timestamp;
    const ageSec = Math.floor(ageMs / 1000);

    log.info(`processing snapshot from ${ageSec}s ago with ${snapshot.runs.length} active run(s)`);

    // Import updateSessionStoreEntry dynamically to avoid circular deps
    const { updateSessionStoreEntry } = await import("../config/sessions/store.js");

    let interruptedCount = 0;

    // Mark each active run as interrupted in the session store
    for (const run of snapshot.runs) {
      try {
        await updateSessionStoreEntry({
          storePath,
          sessionKey: run.sessionKey,
          update: async (existing) => {
            // Only mark as interrupted if this was actually the last run
            if (existing?.lastRunId === run.clientRunId && existing?.lastRunStatus === "running") {
              log.info(`marking run ${run.clientRunId} (session ${run.sessionKey}) as interrupted`);
              interruptedCount++;
              return {
                lastRunStatus: "error" as const,
                lastRunEndedAt: snapshot.timestamp,
                abortedLastRun: true,
              };
            }
            return {};
          },
        });
      } catch (err) {
        log.warn(`failed to mark run ${run.clientRunId} as interrupted: ${err}`);
      }
    }

    await clearActiveRunsSnapshot({ workspaceDir });

    if (interruptedCount > 0) {
      log.info(`marked ${interruptedCount} run(s) as interrupted from snapshot`);
    }

    return {
      processedCount: snapshot.runs.length,
      interruptedCount,
    };
  } catch (err) {
    log.error(`failed to reconcile active runs snapshot: ${err}`);
    return { processedCount: 0, interruptedCount: 0 };
  }
}
