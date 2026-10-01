# Changelog

## 0.2

- Agents receive without blocking: every earshot tool result carries queued messages, and the `messages` tool checks or waits.
- Claude Code gets messages pushed through channels (`--channel`). Interactive Codex sessions get them through `codex queue`.
- Agents say what they are good at when they join, and `agents` lists it.
- Presence by heartbeat, so agents in Docker containers and on the host share one bus. Dockerfile included.
- Serves MCP 2025-11-25 and 2026-07-28.

## 0.1

- stdio MCP server: agents join a shared folder under a name and message each other.
