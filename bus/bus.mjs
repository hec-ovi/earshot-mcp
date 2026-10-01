import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Queue } from './queue.mjs';

const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const EVERYONE = '*';
export const BEAT_MS = 5000;
const STALE_MS = 3 * BEAT_MS;

/** A folder shared by every agent: who is online, and one message queue per name. Works across processes and containers. */
export class Bus {
  constructor(dir) {
    this.dir = dir;
    this.agentsDir = join(dir, 'agents');
    this.messagesDir = join(dir, 'messages');
    mkdirSync(this.agentsDir, { recursive: true });
    mkdirSync(this.messagesDir, { recursive: true });
  }

  /** Takes `name` for `owner` (any unique token) and says what it is good at. Throws when another live owner holds it. */
  claim(name, owner, about = '') {
    if (!NAME.test(name)) throw new Error(`invalid name "${name}": use 1-32 of a-z, 0-9, "-", "_"`);
    const holder = this.#record(name);
    if (holder && holder.owner !== owner) throw new Error(`name "${name}" is taken by a live agent`);
    const file = this.#presence(name);
    writeFileSync(`${file}.${owner}`, JSON.stringify({ name, about, owner, since: holder?.since ?? new Date().toISOString() }));
    renameSync(`${file}.${owner}`, file);
  }

  /** Keeps `name` alive. Returns false when `owner` no longer holds it. */
  beat(name, owner) {
    if (this.#record(name)?.owner !== owner) return false;
    const now = new Date();
    utimesSync(this.#presence(name), now, now);
    return true;
  }

  release(name, owner) {
    if (this.#record(name)?.owner === owner) rmSync(this.#presence(name), { force: true });
  }

  /** Live agents as `{ name, about }`, sorted by name. Records without a recent beat are removed. */
  online() {
    return readdirSync(this.agentsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => this.#record(f.slice(0, -5)))
      .filter(Boolean)
      .map(({ name, about }) => ({ name, about }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Queues `text` for `to` (a name, or `*` for every other agent). Returns the message and its recipients. */
  post(from, to, text) {
    const others = this.online().map((a) => a.name).filter((name) => name !== from);
    if (to !== EVERYONE && !others.includes(to)) {
      throw new Error(`no agent "${to}" online. online: ${others.join(', ') || 'nobody'}`);
    }
    const recipients = to === EVERYONE ? others : [to];
    const message = { id: `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`, from, to, text, at: new Date().toISOString() };
    for (const name of recipients) this.queue(name).put(message);
    return { message, recipients };
  }

  queue(name) {
    return new Queue(join(this.messagesDir, name));
  }

  /**
   * The bus at a glance: whether the folder can be written, who is online with their last beat,
   * and every queue holding messages, including those of agents that are offline.
   */
  status() {
    let writable = true;
    let error;
    try {
      const probe = join(this.dir, `.health-${randomUUID()}`);
      writeFileSync(probe, '');
      rmSync(probe);
    } catch (err) {
      writable = false;
      error = err.message;
    }
    const now = Date.now();
    const agents = [];
    for (const { name } of this.online()) {
      try {
        const { about, since } = JSON.parse(readFileSync(this.#presence(name), 'utf8'));
        agents.push({ name, about, since, lastBeatMs: Math.round(now - statSync(this.#presence(name)).mtimeMs) });
      } catch {
        // Gone between listing and reading.
      }
    }
    const queued = {};
    for (const name of readdirSync(this.messagesDir)) {
      const waiting = this.queue(name).size();
      if (waiting) queued[name] = waiting;
    }
    return { dir: this.dir, writable, ...(error ? { error } : {}), agents, queued };
  }

  #presence(name) {
    return join(this.agentsDir, `${name}.json`);
  }

  /** The live record for `name`, or null. A record with no recent beat is deleted. */
  #record(name) {
    const file = this.#presence(name);
    try {
      if (Date.now() - statSync(file).mtimeMs > STALE_MS) {
        rmSync(file, { force: true });
        return null;
      }
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }
}
