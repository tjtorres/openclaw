# Session Persistence on Gateway Restart

## Overview

By default, OpenClaw sessions reset based on time-based policies (daily resets or idle timeouts). This can cause conversations to reset after a gateway restart if enough time has passed.

The `session.preserveAcrossRestarts` configuration option allows sessions to persist across gateway restarts regardless of time-based policies, until explicitly cleared by the user.

## Configuration

Add to your `config.toml`:

```toml
[session]
preserveAcrossRestarts = true
```

When enabled:

- Sessions continue from where they left off after a gateway restart
- Time-based reset policies (daily/idle) are ignored
- Sessions only reset when explicitly triggered (e.g., `/new`, `/reset`)
- Session transcripts (.jsonl files) are preserved and restored

## Default Behavior (preserveAcrossRestarts = false)

Without this option, sessions follow the configured reset policy:

- **Daily mode**: Sessions reset at a specific hour (default 4am local time)
- **Idle mode**: Sessions reset after N minutes of inactivity

After a gateway restart, if a session is "stale" according to these policies, it will start fresh with a new session ID and empty transcript.

## Use Cases

### When to Enable

- Development/testing: Maintain context across frequent restarts
- Production: Provide seamless experience after maintenance restarts
- Long-running assistants: Preserve conversation history indefinitely
- Stateful workflows: Don't lose progress due to infrastructure events

### When to Keep Disabled

- Privacy-conscious deployments: Automatic cleanup of old conversations
- Multi-user scenarios: Fresh context for each daily interaction
- Memory management: Prevent transcript files from growing indefinitely

## Explicit Reset Triggers

Even with `preserveAcrossRestarts = true`, users can manually reset sessions using configured triggers:

```toml
[session]
preserveAcrossRestarts = true
resetTriggers = ["/new", "/reset", "/clear"]
```

Sending any of these triggers will:

1. Generate a new session ID
2. Start a fresh transcript file
3. Clear conversation context

## Implementation Details

- Session metadata is stored in `sessions.json` with `updatedAt` timestamps
- Transcripts are stored as `.jsonl` files in the sessions directory
- When `preserveAcrossRestarts = true`, the freshness check always passes
- The session ID from the metadata file is reused, continuing the conversation
- Existing time-based reset configs are ignored but remain valid

## Related Configuration

```toml
[session]
scope = "per-sender"                    # Session scope
preserveAcrossRestarts = true           # Enable persistence
resetTriggers = ["/new"]                # Explicit reset commands

[session.reset]
mode = "daily"                          # Ignored when preserve enabled
atHour = 4

[session.resetByType]
dm = { mode = "idle", idleMinutes = 60 }    # Ignored when preserve enabled
group = { mode = "daily", atHour = 4 }
```

## Testing

Run the test suite:

```bash
pnpm test session.preserve-on-restart
```

## Migration

Existing sessions will automatically benefit from this feature when enabled. No migration required.
