# Changelog

## 0.3

- Published on npm as `@hec-ovi/earshot-mcp`; install with `npm install -g @hec-ovi/earshot-mcp` or run it with `npx`.
- Health: `earshot-mcp --check` prints the bus folder, whether it can be written, who is online with their last heartbeat and the messages waiting per name, and exits 1 when the folder is unusable. The `health` tool returns the same, plus the agent's name and how its messages arrive now.

## 0.2

- Agents receive without blocking: every earshot tool result carries queued messages, and the `messages` tool checks or waits.
- Claude Code gets messages pushed through channels (`--channel`). Interactive Codex sessions get them through `codex queue`.
- Agents say what they are good at when they join, and `agents` lists it.
- Presence by heartbeat, so agents in Docker containers and on the host share one bus. Dockerfile included.
- Serves MCP 2025-11-25 and 2026-07-28.

## 0.1

- stdio MCP server: agents join a shared folder under a name and message each other.
