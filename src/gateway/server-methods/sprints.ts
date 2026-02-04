import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

// --- Types ---

export type SprintStatus = "active" | "completed" | "cancelled";

export type SprintCard = {
  cardId: string;
  cardName: string;
  addedAt: string;
  completedAt: string | null;
};

export type Sprint = {
  id: string;
  name: string;
  goal: string;
  status: SprintStatus;
  startDate: string;
  endDate: string;
  cards: SprintCard[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type SprintsFile = {
  sprints: Sprint[];
  nextId: number;
};

// --- Storage ---

function sprintsPath(): string {
  const workspace =
    process.env.OPENCLAW_WORKSPACE ??
    join(process.env.HOME ?? "/home/teej", ".openclaw", "workspace");
  return join(workspace, "sprints.json");
}

function readSprints(): SprintsFile {
  const p = sprintsPath();
  if (!existsSync(p)) return { sprints: [], nextId: 1 };
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return { sprints: [], nextId: 1 };
  }
}

function writeSprints(file: SprintsFile): void {
  writeFileSync(sprintsPath(), JSON.stringify(file, null, 2) + "\n");
}

// --- Burndown calculation ---

type BurndownPoint = { date: string; remaining: number; completed: number; total: number };

function computeBurndown(sprint: Sprint): BurndownPoint[] {
  const start = new Date(sprint.startDate);
  const end = new Date(sprint.endDate);
  const total = sprint.cards.length;
  const points: BurndownPoint[] = [];

  // Generate a point for each day in the sprint
  const current = new Date(start);
  while (current <= end && current <= new Date()) {
    const dateStr = current.toISOString().split("T")[0]!;
    const completedByDate = sprint.cards.filter(
      (c) => c.completedAt && c.completedAt.split("T")[0]! <= dateStr,
    ).length;
    points.push({
      date: dateStr,
      remaining: total - completedByDate,
      completed: completedByDate,
      total,
    });
    current.setDate(current.getDate() + 1);
  }

  return points;
}

// --- Velocity (cards completed per sprint) ---

function computeVelocity(sprints: Sprint[]): Array<{ sprintId: string; name: string; completed: number; total: number; days: number }> {
  return sprints
    .filter((s) => s.status === "completed")
    .slice(-5) // last 5 sprints
    .map((s) => {
      const days = Math.max(
        1,
        Math.ceil(
          (new Date(s.endDate).getTime() - new Date(s.startDate).getTime()) / 86400000,
        ),
      );
      return {
        sprintId: s.id,
        name: s.name,
        completed: s.cards.filter((c) => c.completedAt).length,
        total: s.cards.length,
        days,
      };
    });
}

// --- RPC Handlers ---

export const sprintHandlers: GatewayRequestHandlers = {
  "sprints.list": ({ respond }) => {
    const file = readSprints();
    const active = file.sprints.find((s) => s.status === "active") ?? null;
    const velocity = computeVelocity(file.sprints);

    respond(true, {
      sprints: file.sprints.map((s) => ({
        ...s,
        cardCount: s.cards.length,
        completedCount: s.cards.filter((c) => c.completedAt).length,
      })),
      active: active
        ? {
            ...active,
            burndown: computeBurndown(active),
            cardCount: active.cards.length,
            completedCount: active.cards.filter((c) => c.completedAt).length,
          }
        : null,
      velocity,
      fetchedAt: Date.now(),
    });
  },

  "sprints.create": async ({ params, respond }) => {
    const { name, goal, startDate, endDate, cardIds, pullFromBoard } = params as {
      name?: string;
      goal?: string;
      startDate?: string;
      endDate?: string;
      cardIds?: Array<{ id: string; name: string }>;
      pullFromBoard?: boolean;
    };

    if (!name) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "name required"));
      return;
    }

    const file = readSprints();

    // Only one active sprint at a time
    if (file.sprints.some((s) => s.status === "active")) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "An active sprint already exists. Complete or cancel it first."),
      );
      return;
    }

    // Optionally pull cards from Trello board (Approved + In Progress)
    let boardCards: Array<{ id: string; name: string }> = cardIds ?? [];
    if (pullFromBoard) {
      try {
        const workspace = process.env.OPENCLAW_WORKSPACE ?? join(process.env.HOME ?? "/home/teej", ".openclaw", "workspace");
        const configPath = join(workspace, "trello_task_queue.json");
        const config = JSON.parse(readFileSync(configPath, "utf-8"));
        const apiKey = process.env.TRELLO_API_KEY;
        const apiToken = process.env.TRELLO_TOKEN;
        if (apiKey && apiToken) {
          const res = await fetch(
            `https://api.trello.com/1/boards/${config.boardId}/cards?fields=name,idList&key=${apiKey}&token=${apiToken}`,
          );
          if (res.ok) {
            const cards = (await res.json()) as Array<{ id: string; name: string; idList: string }>;
            const approvedList = config.lists?.Approved;
            const inProgressList = config.lists?.["In Progress"];
            const pulled = cards.filter(
              (c) => c.idList === approvedList || c.idList === inProgressList,
            );
            // Merge with any explicitly provided cards, dedup by id
            const seen = new Set(boardCards.map((c) => c.id));
            for (const c of pulled) {
              if (!seen.has(c.id)) {
                boardCards.push({ id: c.id, name: c.name });
                seen.add(c.id);
              }
            }
          }
        }
      } catch {}
    }

    const now = new Date().toISOString();
    const sprint: Sprint = {
      id: `SPR-${String(file.nextId).padStart(3, "0")}`,
      name,
      goal: goal ?? "",
      status: "active",
      startDate: startDate ?? now.split("T")[0]!,
      endDate: endDate ?? new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0]!,
      cards: boardCards.map((c) => ({
        cardId: c.id,
        cardName: c.name,
        addedAt: now,
        completedAt: null,
      })),
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };

    file.sprints.push(sprint);
    file.nextId++;
    writeSprints(file);

    respond(true, { sprint });
  },

  "sprints.update": ({ params, respond }) => {
    const { sprintId, name, goal, endDate, status } = params as {
      sprintId?: string;
      name?: string;
      goal?: string;
      endDate?: string;
      status?: SprintStatus;
    };

    if (!sprintId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "sprintId required"));
      return;
    }

    const file = readSprints();
    const sprint = file.sprints.find((s) => s.id === sprintId);
    if (!sprint) {
      respond(false, undefined, errorShape(ErrorCodes.NOT_FOUND, "Sprint not found"));
      return;
    }

    const now = new Date().toISOString();
    if (name) sprint.name = name;
    if (goal !== undefined) sprint.goal = goal;
    if (endDate) sprint.endDate = endDate;
    if (status) {
      sprint.status = status;
      if (status === "completed" || status === "cancelled") {
        sprint.completedAt = now;
      }
    }
    sprint.updatedAt = now;
    writeSprints(file);

    respond(true, { sprint });
  },

  "sprints.addCard": ({ params, respond }) => {
    const { sprintId, cardId, cardName } = params as {
      sprintId?: string;
      cardId?: string;
      cardName?: string;
    };

    if (!sprintId || !cardId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sprintId and cardId required"),
      );
      return;
    }

    const file = readSprints();
    const sprint = file.sprints.find((s) => s.id === sprintId);
    if (!sprint) {
      respond(false, undefined, errorShape(ErrorCodes.NOT_FOUND, "Sprint not found"));
      return;
    }

    if (sprint.cards.some((c) => c.cardId === cardId)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Card already in sprint"));
      return;
    }

    sprint.cards.push({
      cardId,
      cardName: cardName ?? cardId,
      addedAt: new Date().toISOString(),
      completedAt: null,
    });
    sprint.updatedAt = new Date().toISOString();
    writeSprints(file);

    respond(true, { ok: true });
  },

  "sprints.completeCard": ({ params, respond }) => {
    const { sprintId, cardId } = params as { sprintId?: string; cardId?: string };

    if (!sprintId || !cardId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sprintId and cardId required"),
      );
      return;
    }

    const file = readSprints();
    const sprint = file.sprints.find((s) => s.id === sprintId);
    if (!sprint) {
      respond(false, undefined, errorShape(ErrorCodes.NOT_FOUND, "Sprint not found"));
      return;
    }

    const card = sprint.cards.find((c) => c.cardId === cardId);
    if (!card) {
      respond(false, undefined, errorShape(ErrorCodes.NOT_FOUND, "Card not in sprint"));
      return;
    }

    card.completedAt = new Date().toISOString();
    sprint.updatedAt = new Date().toISOString();
    writeSprints(file);

    respond(true, { ok: true });
  },

  "sprints.removeCard": ({ params, respond }) => {
    const { sprintId, cardId } = params as { sprintId?: string; cardId?: string };

    if (!sprintId || !cardId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sprintId and cardId required"),
      );
      return;
    }

    const file = readSprints();
    const sprint = file.sprints.find((s) => s.id === sprintId);
    if (!sprint) {
      respond(false, undefined, errorShape(ErrorCodes.NOT_FOUND, "Sprint not found"));
      return;
    }

    sprint.cards = sprint.cards.filter((c) => c.cardId !== cardId);
    sprint.updatedAt = new Date().toISOString();
    writeSprints(file);

    respond(true, { ok: true });
  },
};
