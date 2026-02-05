#!/usr/bin/env node
/**
 * Test script for context persistence (Phase 1)
 *
 * This script:
 * 1. Creates a fake session with lastRunStatus="running"
 * 2. Calls reconcileInterruptedRuns()
 * 3. Verifies the session was marked as interrupted
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import from the built dist
const modulePath = join(__dirname, "dist", "gateway", "boot.js");
let reconcileInterruptedRuns;
try {
  const bootModule = await import(modulePath);
  reconcileInterruptedRuns = bootModule.reconcileInterruptedRuns;
} catch (err) {
  console.error("❌ Failed to load boot module:", err.message);
  console.error("   Make sure you run `pnpm build` first");
  process.exit(1);
}

// Test configuration
const testAgentId = "test-agent";
const testSessionsPath = join(
  __dirname,
  ".openclaw-test",
  "agents",
  testAgentId,
  "sessions",
  "sessions.json",
);

async function setupTestSession() {
  const { mkdirSync } = await import("node:fs");
  const sessionsDir = dirname(testSessionsPath);

  // Create directory structure
  mkdirSync(sessionsDir, { recursive: true });

  // Create a session with an interrupted run
  const testStore = {
    "test-session-1": {
      sessionKey: "test-session-1",
      agentId: testAgentId,
      createdAt: Date.now() - 3600000,
      updatedAt: Date.now() - 1800000,
      lastRunId: "test-run-123",
      lastRunStatus: "running", // Simulate interrupted run
      lastRunStartedAt: Date.now() - 1800000,
      lastRunEndedAt: undefined,
    },
    "test-session-2": {
      sessionKey: "test-session-2",
      agentId: testAgentId,
      createdAt: Date.now() - 7200000,
      updatedAt: Date.now() - 3600000,
      lastRunId: "test-run-456",
      lastRunStatus: "completed", // Already completed, should not change
      lastRunStartedAt: Date.now() - 3600000,
      lastRunEndedAt: Date.now() - 3500000,
    },
  };

  writeFileSync(testSessionsPath, JSON.stringify(testStore, null, 2));
  console.log("✅ Created test session store at:", testSessionsPath);
  return testStore;
}

async function runTest() {
  console.log("🧪 Testing context persistence (Phase 1)\n");

  // Setup test data
  const originalStore = await setupTestSession();

  // Create minimal config pointing to test directory
  const testConfig = {
    agents: {
      workspace: join(__dirname, ".openclaw-test"),
      defaults: {
        agent: testAgentId,
      },
    },
  };

  console.log("📝 Initial state:");
  console.log("   test-session-1:", originalStore["test-session-1"].lastRunStatus);
  console.log("   test-session-2:", originalStore["test-session-2"].lastRunStatus);
  console.log();

  // Run reconciliation
  console.log("🔄 Running reconcileInterruptedRuns()...");
  try {
    const count = await reconcileInterruptedRuns(testConfig);
    console.log(`✅ Reconciled ${count} interrupted run(s)\n`);
  } catch (err) {
    console.error("❌ Reconciliation failed:", err.message);
    process.exit(1);
  }

  // Verify results
  const updatedStore = JSON.parse(readFileSync(testSessionsPath, "utf-8"));

  console.log("📊 Final state:");
  console.log("   test-session-1:", updatedStore["test-session-1"].lastRunStatus);
  console.log("   test-session-2:", updatedStore["test-session-2"].lastRunStatus);
  console.log();

  // Assertions
  let passed = true;

  if (updatedStore["test-session-1"].lastRunStatus !== "error") {
    console.error('❌ FAIL: test-session-1 should be marked as "error"');
    passed = false;
  } else {
    console.log("✅ PASS: test-session-1 correctly marked as interrupted");
  }

  if (updatedStore["test-session-1"].lastRunEndedAt === undefined) {
    console.error("❌ FAIL: test-session-1 should have lastRunEndedAt timestamp");
    passed = false;
  } else {
    console.log("✅ PASS: test-session-1 has lastRunEndedAt timestamp");
  }

  if (updatedStore["test-session-2"].lastRunStatus !== "completed") {
    console.error('❌ FAIL: test-session-2 should remain "completed"');
    passed = false;
  } else {
    console.log("✅ PASS: test-session-2 unchanged");
  }

  console.log();
  if (passed) {
    console.log("🎉 All tests passed!");
    process.exit(0);
  } else {
    console.log("💥 Some tests failed");
    process.exit(1);
  }
}

runTest().catch((err) => {
  console.error("💥 Test error:", err);
  process.exit(1);
});
