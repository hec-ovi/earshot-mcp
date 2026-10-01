import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { Bus } from '../bus/bus.mjs';
import { Session } from './session.mjs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const WAIT_SECONDS = 45;
const LOCAL = { openWorldHint: false };

const prompt = (name) => readFileSync(new URL(`./prompts/${name}.md`, import.meta.url), 'utf8').trim();

/** The MCP server for one session: tools join, send, wait, agents. `channel` declares Claude Code push. */
export function createServer(session, { channel = false } = {}) {
  const mcp = new McpServer(
    { name: 'earshot', version },
    {
      capabilities: channel ? { experimental: { 'claude/channel': {} } } : {},
      instructions: channel ? `${prompt('instructions')}\n\n${prompt('channel')}` : prompt('instructions'),
    },
  );
  const tool = (name, annotations, shape, run) =>
    mcp.registerTool(name, { description: prompt(name), inputSchema: z.object(shape), annotations: { ...LOCAL, ...annotations } }, async (args, ctx) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(await run(args, ctx)) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: err.message }], isError: true };
      }
    });

  tool('join', { destructiveHint: false, idempotentHint: true }, { name: z.string().describe('your name on the bus') }, ({ name }) =>
    session.join(name),
  );
  tool(
    'send',
    { destructiveHint: false },
    { to: z.string().describe('agent name, or "*" for everyone'), text: z.string().describe('the message') },
    ({ to, text }) => session.send(to, text),
  );
  tool(
    'wait',
    { destructiveHint: false },
    { seconds: z.number().positive().optional().describe(`how long to wait, default ${WAIT_SECONDS}`) },
    async ({ seconds }, ctx) => ({ messages: await session.wait(seconds ?? WAIT_SECONDS, ctx.mcpReq.signal) }),
  );
  tool('agents', { readOnlyHint: true }, {}, () => session.agents());
  return mcp;
}

/** Serves one agent over stdio on the bus in `dir`. With `channel`, mail is pushed as `notifications/claude/channel`. */
export function serve({ dir, channel = false }) {
  let mcp = null;
  const push = (message) =>
    mcp.server.notification({
      method: 'notifications/claude/channel',
      params: { content: message.text, meta: { from: message.from, id: message.id } },
    });
  const session = new Session(new Bus(dir), channel ? push : null);
  serveStdio(() => (mcp = createServer(session, { channel })));
  process.on('exit', () => session.leave());
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(0));
}
