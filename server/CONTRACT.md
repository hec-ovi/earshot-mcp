# CONTRACT: server

Version 0.2. An MCP server over stdio for one agent: join the bus under a name, message other agents, receive theirs without blocking.

## In

- `earshot-mcp [--channel]`, spawned by the MCP client (or `docker run -i` with the bus mounted at `/bus`).
- `--channel`: push messages to Claude Code as channel notifications. Needs `claude --dangerously-load-development-channels server:<name>`; without it Claude Code drops pushes. Serves only the 2025-11-25 `initialize` handshake, which channels need.
- Without `--channel`: MCP 2025-11-25 and 2026-07-28 (stateless), through `serveStdio`.
- `EARSHOT_DIR`: bus folder, default `~/.earshot`. Agents that talk share it.
- Tool call `_meta['x-codex-turn-metadata']` (`thread_id`, `turn_trigger` `user` or `queue`): arms the Codex doorbell for that thread.

## Out

Tools. Each returns one JSON text block; failures come back with `isError: true` and a plain message. Every result also carries queued messages under `messages` when there are some.

| Tool | In | Out |
|---|---|---|
| `join` | `name`, `about?` | `{ you, online: [{ name, about }] }` |
| `send` | `to` (name or `*`), `text` | `{ id, to: [names] }` |
| `messages` | `wait?` seconds, default 0 | `{ messages: [{ id, from, to, text, at }] }` |
| `agents` | | `{ you, online: [{ name, about }] }` |

Delivery, first match wins:

1. A pending `messages` wait gets the message.
2. A doorbell puts it into the conversation:
   - Claude Code (`--channel`): `notifications/claude/channel`, `{ content: text, meta: { from, id } }`.
   - Codex: `codex queue --thread <thread_id> --message <prompts/queued.md>`. An idle session starts a turn; a busy one gets it after the current turn.
3. Otherwise it stays queued and rides on the agent's next tool result.

A doorbell that fails puts the message back and is dropped until the next tool call re-arms it. Each message is delivered once. On exit (stdin closed, SIGINT, SIGTERM, SIGHUP) the name is released.

## Errors and invariants

- Every tool but `agents` needs `join` first.
- A second `messages` wait ends the first with none. Messages do not ride on other results while a wait is pending.
- Instructions and tool descriptions live in `prompts/*.md`.

## Depends on

- [bus/CONTRACT.md](../bus/CONTRACT.md)
- `@modelcontextprotocol/server` 2.x, `zod` 4.x
- `codex` on `PATH` for the Codex doorbell
