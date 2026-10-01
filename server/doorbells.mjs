import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';

const QUEUED = readFileSync(new URL('./prompts/queued.md', import.meta.url), 'utf8').trim();
const INTERACTIVE = ['user', 'queue'];

/** Claude Code channel: the message enters the session as a <channel> tag, between tool calls or as a new turn. */
export const claudeChannel = (mcp) => async (message) => {
  await mcp.server.notification({
    method: 'notifications/claude/channel',
    params: { content: message.text, meta: { from: message.from, id: message.id } },
  });
  return true;
};

/** Codex: `codex queue` adds the message to the session's own queue. An idle session starts a turn with it. */
export const codexQueue = (thread) => (message) =>
  new Promise((resolve) => {
    const text = QUEUED.replaceAll('{from}', message.from).replace('{text}', message.text);
    execFile('codex', ['queue', '--thread', thread, '--message', text], { timeout: 30_000 }, (err) => resolve(!err));
  });

/** The doorbell a tool call's metadata offers, or null. Interactive Codex sessions send their thread id with every call. */
export function doorbellFor(meta) {
  const turn = meta?.['x-codex-turn-metadata'];
  return turn?.thread_id && INTERACTIVE.includes(turn.turn_trigger) ? codexQueue(turn.thread_id) : null;
}
