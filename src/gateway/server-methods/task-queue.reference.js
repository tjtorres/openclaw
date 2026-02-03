import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_AGENT_WORKSPACE_DIR } from "../../agents/workspace.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
const TRELLO_CACHE_TTL_MS = 15_000;
const TASK_QUEUE_CONFIG = "trello_task_queue.json";
const cache = {};
function resolveEnvKey(name) {
    return (process.env[name] || "").trim();
}
function resolveTrelloAuth() {
    const apiKey = resolveEnvKey("TRELLO_API_KEY") || resolveEnvKey("TRELLO_KEY");
    const token = resolveEnvKey("TRELLO_TOKEN");
    if (!apiKey || !token) {
        return null;
    }
    return { apiKey, token };
}
async function loadTaskQueueConfig() {
    const configPath = path.join(DEFAULT_AGENT_WORKSPACE_DIR, TASK_QUEUE_CONFIG);
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.boardId) {
        throw new Error("trello_task_queue.json missing boardId");
    }
    return { boardId: parsed.boardId };
}
async function fetchSnapshot() {
    const auth = resolveTrelloAuth();
    if (!auth) {
        throw new Error("Missing Trello credentials (TRELLO_API_KEY/TRELLO_TOKEN)");
    }
    const { boardId } = await loadTaskQueueConfig();
    const params = new URLSearchParams({ key: auth.apiKey, token: auth.token });
    const boardRes = await fetch(`https://api.trello.com/1/boards/${boardId}?fields=name,shortUrl&${params.toString()}`);
    if (!boardRes.ok) {
        throw new Error(`Trello board fetch failed (${boardRes.status})`);
    }
    const boardJson = (await boardRes.json());
    const listsRes = await fetch(`https://api.trello.com/1/boards/${boardId}/lists?fields=name,closed&${params.toString()}`);
    if (!listsRes.ok) {
        throw new Error(`Trello lists fetch failed (${listsRes.status})`);
    }
    const listsJson = (await listsRes.json());
    const cardsRes = await fetch(`https://api.trello.com/1/boards/${boardId}/cards?fields=name,idList,shortUrl,labels&${params.toString()}`);
    if (!cardsRes.ok) {
        throw new Error(`Trello cards fetch failed (${cardsRes.status})`);
    }
    const cardsJson = (await cardsRes.json());
    const listNameMap = new Map(listsJson.map((list) => [list.id, list.name]));
    const cards = cardsJson.map((card) => ({
        id: card.id,
        name: card.name,
        url: card.shortUrl,
        listId: card.idList,
        listName: listNameMap.get(card.idList) ?? null,
        labels: (card.labels ?? []).map((label) => label.name || label.id || "").filter(Boolean),
    }));
    return {
        board: {
            id: boardJson.id ?? boardId,
            name: boardJson.name ?? "Trello Board",
            url: boardJson.shortUrl ?? null,
        },
        lists: listsJson.map((list) => ({
            id: list.id,
            name: list.name,
            closed: list.closed ?? null,
        })),
        cards,
        fetchedAt: Date.now(),
    };
}
async function loadSnapshotCached() {
    const now = Date.now();
    if (cache.snapshot && cache.updatedAt && now - cache.updatedAt < TRELLO_CACHE_TTL_MS) {
        return cache.snapshot;
    }
    if (cache.inFlight) {
        return await cache.inFlight;
    }
    cache.inFlight = fetchSnapshot()
        .then((snapshot) => {
        cache.snapshot = snapshot;
        cache.updatedAt = Date.now();
        return snapshot;
    })
        .finally(() => {
        cache.inFlight = undefined;
    });
    return await cache.inFlight;
}
export const taskQueueHandlers = {
    "taskQueue.list": async ({ respond }) => {
        try {
            const snapshot = await loadSnapshotCached();
            respond(true, snapshot, undefined);
        }
        catch (err) {
            respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
        }
    },
};
