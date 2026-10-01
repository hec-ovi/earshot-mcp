# Working on earshot

Two boxes, each with a `CONTRACT.md`: `bus/` (the shared folder: presence and message queues) and `server/` (MCP tools and delivery into each CLI). Read a box's contract before changing it or code that calls it, and update the contract with the code.

- `npm test` runs the unit tests and the end-to-end tests, which drive real server processes over stdio.
- Instructions and tool descriptions live in `server/prompts/*.md`, never inline in code.
- stdout belongs to the MCP protocol. Log to stderr.
- The bus folder comes from `EARSHOT_DIR`. No user paths in code.
- Use the configured Git author.
