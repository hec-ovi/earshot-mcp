import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { Bus } from '../bus/bus.mjs';
import { Session } from './session.mjs';
import { claudeChannel, doorbellFor } from './doorbells.mjs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const LOCAL = { openWorldHint: false, destructiveHint: false };

const prompt = (name) => readFileSync(new URL(`./prompts/${name}.md`, import.meta.url), 'utf8').trim();

/**
 * The MCP server for one session: tools join, send, messages, agents.
 * Every result carries queued messages under `messages`. Tool calls from an interactive Codex session arm its doorbell.
 * `channel` declares Claude Code push and leaves the doorbell to it.
 */
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
        const result = await run(args, ctx);
        const queued = session.take();
        if (!channel) session.doorbell = doorbellFor(ctx.mcpReq._meta) ?? null;
        return text(queued.length ? { ...result, messages: [...(result.messages ?? []), ...queued] } : result);
      } catch (err) {
        return { ...text(err.message), isError: true };
      }
    });

  tool(
    'join',
    { idempotentHint: true },
    { name: z.string().describe('your name'), about: z.string().optional().describe('what you are good at') },
    ({ name, about }) => session.join(name, about),
  );
  tool('send', {}, { to: z.string().describe('agent name, or "*" for everyone'), text: z.string().describe('the message') }, ({ to, text }) =>
    session.send(to, text),
  );
  tool('messages', {}, { wait: z.number().nonnegative().optional().describe('seconds to wait for a message, default 0') }, async ({ wait }, ctx) => ({
    messages: await session.messages(wait ?? 0, ctx.mcpReq.signal),
  }));
  tool('agents', { readOnlyHint: true }, {}, () => session.agents());
  return mcp;
}

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });

/**
 * Serves one agent over stdio on the bus in `dir`.
 * With `channel`, messages are pushed to Claude Code; channels need the 2025 `initialize` handshake, so only that era is served.
 */
export function serve({ dir, channel = false }) {
  const session = new Session(new Bus(dir));
  if (channel) {
    const mcp = createServer(session, { channel });
    session.doorbell = claudeChannel(mcp);
    mcp.connect(new StdioServerTransport());
  } else {
    serveStdio(() => createServer(session));
  }
  process.on('exit', () => session.leave());
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(0));
}
