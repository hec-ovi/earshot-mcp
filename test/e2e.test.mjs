import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';

const BIN = new URL('../bin/earshot.mjs', import.meta.url).pathname;

/** A raw JSON-RPC client over stdio, the way Claude Code and Codex talk to the server. */
class Peer {
  #id = 0;
  #pending = new Map();
  #listeners = [];

  static async start(dir, args = [], env = {}) {
    const peer = new Peer(dir, args, env);
    await peer.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    peer.notify('notifications/initialized');
    return peer;
  }

  constructor(dir, args, env) {
    this.child = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, ...env, EARSHOT_DIR: dir }, stdio: ['pipe', 'pipe', 'inherit'] });
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && this.#pending.has(msg.id)) {
        this.#pending.get(msg.id)(msg);
        this.#pending.delete(msg.id);
      } else this.#listeners.forEach((fn) => fn(msg));
    });
  }

  request(method, params) {
    const id = ++this.#id;
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise((resolve) => this.#pending.set(id, resolve));
  }

  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  async call(name, args = {}, _meta) {
    const { result } = await this.request('tools/call', { name, arguments: args, _meta });
    const text = result.content[0].text;
    if (result.isError) throw new Error(text);
    return JSON.parse(text);
  }

  next(method) {
    return new Promise((resolve) => {
      const fn = (msg) => {
        if (msg.method !== method) return;
        this.#listeners = this.#listeners.filter((f) => f !== fn);
        resolve(msg.params);
      };
      this.#listeners.push(fn);
    });
  }

  async close() {
    this.child.stdin.end();
    await once(this.child, 'exit');
  }
}

const bus = () => mkdtempSync(join(tmpdir(), 'earshot-e2e-'));

/** A stand-in `codex` on PATH that records its arguments and exits with FAKE_CODEX_EXIT. */
function fakeCodex() {
  const dir = mkdtempSync(join(tmpdir(), 'earshot-codex-'));
  const log = join(dir, 'calls.jsonl');
  const bin = join(dir, 'codex');
  writeFileSync(bin, `#!${process.execPath}\nrequire('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');\nprocess.exit(Number(process.env.FAKE_CODEX_EXIT || 0));\n`);
  chmodSync(bin, 0o755);
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { env: { PATH: `${dir}:${process.env.PATH}` }, calls };
}

const codexTurn = (trigger) => ({ threadId: 'T1', 'x-codex-turn-metadata': { thread_id: 'T1', turn_trigger: trigger } });

async function until(fn, ms = 5000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('two agents listen and send at the same time', async () => {
  const dir = bus();
  const [alpha, beta] = await Promise.all([Peer.start(dir), Peer.start(dir)]);
  await alpha.call('join', { name: 'alpha', about: 'web search' });
  assert.deepEqual((await beta.call('join', { name: 'beta' })).online, [{ name: 'alpha', about: 'web search' }]);

  const alphaHears = alpha.call('inbox', { wait: 10 });
  const betaHears = beta.call('inbox', { wait: 10 });
  await Promise.all([alpha.call('send', { to: 'beta', text: 'ping' }), beta.call('send', { to: 'alpha', text: 'pong' })]);
  const [toAlpha, toBeta] = await Promise.all([alphaHears, betaHears]);
  assert.deepEqual(toAlpha.mail.map((m) => [m.from, m.text]), [['beta', 'pong']]);
  assert.deepEqual(toBeta.mail.map((m) => [m.from, m.text]), [['alpha', 'ping']]);

  await alpha.close();
  assert.deepEqual(await beta.call('agents'), { you: 'beta', online: [] });
  await beta.close();
});

test('mail queues and rides along on the next tool result', async () => {
  const dir = bus();
  const [alpha, beta] = await Promise.all([Peer.start(dir), Peer.start(dir)]);
  await alpha.call('join', { name: 'alpha' });
  await beta.call('join', { name: 'beta' });
  await alpha.call('send', { to: 'beta', text: 'one' });
  await alpha.call('send', { to: '*', text: 'two' });
  assert.deepEqual((await beta.call('agents')).mail.map((m) => m.text), ['one', 'two']);
  assert.deepEqual(await beta.call('inbox'), { mail: [] });
  assert.deepEqual(await beta.call('inbox', { wait: 0.2 }), { mail: [] });
  await Promise.all([alpha.close(), beta.close()]);
});

test('a channel agent gets mail pushed', async () => {
  const dir = bus();
  const [claude, codex] = await Promise.all([Peer.start(dir, ['--channel']), Peer.start(dir)]);
  await claude.call('join', { name: 'claude' });
  await codex.call('join', { name: 'codex' });
  const pushed = claude.next('notifications/claude/channel');
  const { id } = await codex.call('send', { to: 'claude', text: 'review done' });
  assert.deepEqual(await pushed, { content: 'review done', meta: { from: 'codex', id } });
  await Promise.all([claude.close(), codex.close()]);
});

test('an interactive codex session gets mail through codex queue', async () => {
  const dir = bus();
  const fake = fakeCodex();
  const [claude, codex] = await Promise.all([Peer.start(dir), Peer.start(dir, [], fake.env)]);
  await claude.call('join', { name: 'claude' });
  await codex.call('join', { name: 'codex' }, codexTurn('user'));
  await claude.call('send', { to: 'codex', text: 'make the logo' });
  await until(() => fake.calls().length === 1);
  const [args] = fake.calls();
  assert.deepEqual(args.slice(0, 4), ['queue', '--thread', 'T1', '--message']);
  assert.match(args[4], /from agent "claude"[\s\S]*make the logo/);
  await Promise.all([claude.close(), codex.close()]);
});

test('codex exec runs and failed rings keep mail queued', async () => {
  const dir = bus();
  const fake = fakeCodex();
  const [claude, codex] = await Promise.all([Peer.start(dir), Peer.start(dir, [], { ...fake.env, FAKE_CODEX_EXIT: '1' })]);
  await claude.call('join', { name: 'claude' });
  await codex.call('join', { name: 'codex' }, codexTurn('exec'));
  await claude.call('send', { to: 'codex', text: 'first' });
  await codex.call('agents', {}, codexTurn('user'));
  await claude.call('send', { to: 'codex', text: 'second' });
  await until(() => fake.calls().length === 1);
  const { mail } = await codex.call('inbox', { wait: 2 });
  assert.deepEqual(mail.map((m) => m.text), ['second']);
  await Promise.all([claude.close(), codex.close()]);
});

test('errors come back as tool errors', async () => {
  const dir = bus();
  const [alpha, beta] = await Promise.all([Peer.start(dir), Peer.start(dir)]);
  await assert.rejects(alpha.call('send', { to: 'beta', text: 'hi' }), /call join first/);
  await alpha.call('join', { name: 'alpha' });
  await assert.rejects(beta.call('join', { name: 'alpha' }), /taken/);
  await assert.rejects(alpha.call('send', { to: 'nobody', text: 'hi' }), /no agent "nobody" online/);
  await Promise.all([alpha.close(), beta.close()]);
});
