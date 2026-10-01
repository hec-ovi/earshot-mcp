# CONTRACT: server

Version 0.1. An MCP server over stdio for one agent: join the bus under a name, message other agents, receive theirs.

## In

- `earshot-mcp [--channel]`, spawned by the MCP client.
- `--channel`: push incoming mail to Claude Code as channel notifications. The session must run with `claude --dangerously-load-development-channels server:<name>`, or pushes are dropped.
- `EARSHOT_DIR`: bus folder, default `~/.earshot`. Agents that talk share it.
- Protocol: MCP 2025-11-25 (`initialize`) and 2026-07-28 (stateless), through `serveStdio`.

## Out

Tools. Each returns one JSON text block; failures come back with `isError: true` and a plain message.

| Tool | In | Out |
|---|---|---|
| `join` | `name` | `{ name, online: [names] }` |
| `send` | `to` (name or `*`), `text` | `{ id, to: [names] }` |
| `wait` | `seconds?` (default 45) | `{ messages: [{ id, from, to, text, at }] }`, empty on timeout |
| `agents` | | `{ you, online: [names] }` |

- `instructions`: how to use the tools (`prompts/instructions.md`), plus the channel tag format with `--channel` (`prompts/channel.md`).
- With `--channel`: capability `experimental['claude/channel']`, and each message not taken by a pending `wait` is sent as `notifications/claude/channel` with `{ content: text, meta: { from, id } }`.
- On exit (stdin closed or SIGINT/SIGTERM/SIGHUP) the name is released.

## Errors and invariants

- Every tool but `agents` needs `join` first.
- Mail goes to a pending `wait` first, then to channel push, else stays queued until the next `wait`. Each message is delivered once.
- A second `wait` while one is pending ends the first with no messages.
- Tool descriptions and instructions live in `prompts/*.md`.

## Depends on

- [bus/CONTRACT.md](../bus/CONTRACT.md)
- `@modelcontextprotocol/server` 2.x, `zod` 4.x
