import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import type { MsgContext } from "../templating.js";
import { initSessionState } from "./session.js";

describe("session.preserveAcrossRestarts", () => {
  let tmpDir: string;
  let storePath: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `openclaw-test-${crypto.randomUUID()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    storePath = path.join(tmpDir, "sessions.json");
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("should preserve old sessions when preserveAcrossRestarts=true, even if stale", async () => {
    // Create an existing session entry that's stale (>24h old)
    const now = Date.now();
    const oldSessionId = crypto.randomUUID();
    const staleTimestamp = now - 48 * 60 * 60 * 1000; // 48 hours ago

    // Session key resolution defaults to "agent:main:main" for per-sender DMs
    const sessionKey = "agent:main:main";

    await fs.writeFile(
      storePath,
      JSON.stringify({
        [sessionKey]: {
          sessionId: oldSessionId,
          updatedAt: staleTimestamp,
        },
      }),
      "utf-8",
    );

    const cfg: OpenClawConfig = {
      session: {
        scope: "per-sender",
        preserveAcrossRestarts: true,
        reset: { mode: "daily", atHour: 4 },
        store: storePath,
      },
    };

    const ctx: MsgContext = {
      From: "123",
      To: "openclaw",
      Provider: "telegram",
      Body: "Hello",
    };

    const result = await initSessionState({
      ctx,
      cfg,
      commandAuthorized: false,
    });

    // Session should be preserved (same sessionId, not new)
    expect(result.sessionId).toBe(oldSessionId);
    expect(result.isNewSession).toBe(false);
  });

  it("should reset stale sessions when preserveAcrossRestarts=false (default)", async () => {
    // Create an existing session entry that's stale (>24h old)
    const now = Date.now();
    const oldSessionId = crypto.randomUUID();
    const staleTimestamp = now - 48 * 60 * 60 * 1000; // 48 hours ago

    // Session key resolution defaults to "agent:main:main" for per-sender DMs
    const sessionKey = "agent:main:main";

    await fs.writeFile(
      storePath,
      JSON.stringify({
        [sessionKey]: {
          sessionId: oldSessionId,
          updatedAt: staleTimestamp,
        },
      }),
      "utf-8",
    );

    const cfg: OpenClawConfig = {
      session: {
        scope: "per-sender",
        preserveAcrossRestarts: false,
        reset: { mode: "daily", atHour: 4 },
        store: storePath,
      },
    };

    const ctx: MsgContext = {
      From: "123",
      To: "openclaw",
      Provider: "telegram",
      Body: "Hello",
    };

    const result = await initSessionState({
      ctx,
      cfg,
      commandAuthorized: false,
    });

    // Session should be reset (new sessionId)
    expect(result.sessionId).not.toBe(oldSessionId);
    expect(result.isNewSession).toBe(true);
  });

  it("should still honor explicit reset triggers even with preserveAcrossRestarts=true", async () => {
    // Create an existing session
    const oldSessionId = crypto.randomUUID();

    // Session key resolution defaults to "agent:main:main" for per-sender DMs
    const sessionKey = "agent:main:main";

    await fs.writeFile(
      storePath,
      JSON.stringify({
        [sessionKey]: {
          sessionId: oldSessionId,
          updatedAt: Date.now(),
        },
      }),
      "utf-8",
    );

    const cfg: OpenClawConfig = {
      session: {
        scope: "per-sender",
        preserveAcrossRestarts: true,
        resetTriggers: ["/new"],
        store: storePath,
      },
    };

    const ctx: MsgContext = {
      From: "123",
      To: "openclaw",
      Provider: "telegram",
      Body: "/new",
    };

    const result = await initSessionState({
      ctx,
      cfg,
      commandAuthorized: true,
    });

    // Session should be reset because of explicit trigger
    expect(result.sessionId).not.toBe(oldSessionId);
    expect(result.isNewSession).toBe(true);
    expect(result.resetTriggered).toBe(true);
  });
});
