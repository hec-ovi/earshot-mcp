import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';

const BIN = new URL('../bin/earshot.mjs', import.meta.url).pathname;

/** A raw JSON-RPC client over stdio, the way Claude Code and Codex talk to the server. */
class Peer {
  #id = 0;
  #pending = new Map();
  #listeners = [];

  static async start(dir, ...args) {
    const peer = new Peer(dir, args);
    await peer.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    peer.notify('notifications/initialized');
    return peer;
  }

  constructor(dir, args) {
    this.child = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, EARSHOT_DIR: dir }, stdio: ['pipe', 'pipe', 'inherit'] });
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

  async call(name, args = {}) {
    const { result } = await this.request('tools/call', { name, arguments: args });
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

test('two agents wait and send at the same time', async () => {
  const dir = bus();
  const [alpha, beta] = await Promise.all([Peer.start(dir), Peer.start(dir)]);
  await alpha.call('join', { name: 'alpha' });
  assert.deepEqual((await beta.call('join', { name: 'beta' })).online, ['alpha']);

  const alphaHears = alpha.call('wait', { seconds: 10 });
  const betaHears = beta.call('wait', { seconds: 10 });
  await Promise.all([alpha.call('send', { to: 'beta', text: 'ping' }), beta.call('send', { to: 'alpha', text: 'pong' })]);
  const [toAlpha, toBeta] = await Promise.all([alphaHears, betaHears]);
  assert.deepEqual(toAlpha.messages.map((m) => [m.from, m.text]), [['beta', 'pong']]);
  assert.deepEqual(toBeta.messages.map((m) => [m.from, m.text]), [['alpha', 'ping']]);

  await alpha.close();
  assert.deepEqual(await beta.call('agents'), { you: 'beta', online: [] });
  await beta.close();
});

test('a channel agent gets mail pushed', async () => {
  const dir = bus();
  const [claude, codex] = await Promise.all([Peer.start(dir, '--channel'), Peer.start(dir)]);
  await claude.call('join', { name: 'claude' });
  await codex.call('join', { name: 'codex' });
  const pushed = claude.next('notifications/claude/channel');
  const { id } = await codex.call('send', { to: 'claude', text: 'review done' });
  assert.deepEqual(await pushed, { content: 'review done', meta: { from: 'codex', id } });
  await Promise.all([claude.close(), codex.close()]);
});

test('mail queues until wait, wait times out empty', async () => {
  const dir = bus();
  const [alpha, beta] = await Promise.all([Peer.start(dir), Peer.start(dir)]);
  await alpha.call('join', { name: 'alpha' });
  await beta.call('join', { name: 'beta' });
  await alpha.call('send', { to: 'beta', text: 'one' });
  await alpha.call('send', { to: '*', text: 'two' });
  assert.deepEqual((await beta.call('wait')).messages.map((m) => m.text), ['one', 'two']);
  assert.deepEqual(await beta.call('wait', { seconds: 0.2 }), { messages: [] });
  await Promise.all([alpha.close(), beta.close()]);
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
