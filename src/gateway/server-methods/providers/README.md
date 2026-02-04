# Task Providers

Pluggable backends for the task queue. The active provider is auto-detected
from config at gateway startup.

## Available Providers

| Provider | Backend | Config needed |
|----------|---------|---------------|
| `trello` | Trello API + SQLite | `trello_task_queue.json` + `TRELLO_API_KEY`/`TRELLO_TOKEN` env vars |
| `local` | SQLite only | None (zero-config) |

## How Provider Selection Works

```
1. Gateway starts
2. getProvider() checks for Trello config
3. If found → TrelloProvider (reads from DB, writes to Trello API + DB)
4. If not → LocalProvider (reads/writes SQLite only)
```

## Adding a New Provider

1. Create a file in this directory (e.g., `github.ts`)
2. Implement the `TaskProvider` interface from `../task-provider.ts`
3. Add detection logic to `getProvider()` in `../task-provider.ts`

### Interface (11 methods)

```typescript
interface TaskProvider {
  name: string;
  isConfigured(): boolean;
  list(): Promise<ListResult>;
  cardDetail(cardId: string): Promise<CardDetail | null>;
  moveCard(cardId: string, listId: string): Promise<MutationResult>;
  approveCard(cardId: string): Promise<MutationResult>;
  addComment(cardId: string, text: string): Promise<MutationResult>;
  toggleCheckItem(cardId: string, checkItemId: string, complete: boolean): Promise<MutationResult>;
  markSeen(cardId: string): Promise<MutationResult>;
  cardMetrics(cardId: string): CardMetricsResult;
  sync(): Promise<void>;
}
```

### Key Principles

- **Reads from local DB** — fast, works offline
- **Writes to external service + DB** — keep both in sync
- **Graceful degradation** — if external service is down, DB still works
- **Config stored internally** — constructor reads config, methods don't take config params

## Future Providers

- `github` — GitHub Issues as task backend
- `linear` — Linear issues
- `jira` — Jira issues
- `notion` — Notion databases
