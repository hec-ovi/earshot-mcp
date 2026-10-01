import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Inbox } from './inbox.mjs';

const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const EVERYONE = '*';

/** A folder shared by every agent on the machine: who is online, and one inbox per name. */
export class Bus {
  constructor(dir) {
    this.agentsDir = join(dir, 'agents');
    this.inboxDir = join(dir, 'inbox');
    mkdirSync(this.agentsDir, { recursive: true });
    mkdirSync(this.inboxDir, { recursive: true });
  }

  /** Takes `name` for process `pid`. Throws when a live process already holds it. */
  claim(name, pid = process.pid) {
    if (!NAME.test(name)) throw new Error(`invalid name "${name}": use 1-32 of a-z, 0-9, "-", "_"`);
    const file = this.#presence(name);
    const record = JSON.stringify({ name, pid, since: new Date().toISOString() });
    try {
      writeFileSync(file, record, { flag: 'wx' });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const holder = this.#holder(name);
      if (holder === pid) return;
      if (holder !== null) throw new Error(`name "${name}" is taken by a live agent`);
      writeFileSync(file, record);
    }
  }

  /** Frees `name` if `pid` holds it. */
  release(name, pid = process.pid) {
    if (this.#holder(name) === pid) rmSync(this.#presence(name), { force: true });
  }

  /** Names held by live processes, sorted. Stale records are removed. */
  online() {
    return readdirSync(this.agentsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .filter((name) => this.#holder(name) !== null)
      .sort();
  }

  /** Drops `text` into the inbox of `to` (a name, or `*` for everyone else). Returns the message and its recipients. */
  post(from, to, text) {
    const others = this.online().filter((name) => name !== from);
    const recipients = to === EVERYONE ? others : [to];
    if (to !== EVERYONE && !others.includes(to)) {
      throw new Error(`no agent "${to}" online. online: ${others.join(', ') || 'nobody'}`);
    }
    const message = { id: `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`, from, to, text, at: new Date().toISOString() };
    for (const name of recipients) {
      const dir = join(this.inboxDir, name);
      mkdirSync(dir, { recursive: true });
      const file = `${String(Date.now()).padStart(15, '0')}-${message.id}.json`;
      writeFileSync(join(dir, `.${file}`), JSON.stringify(message));
      renameSync(join(dir, `.${file}`), join(dir, file));
    }
    return { message, recipients };
  }

  inbox(name) {
    return new Inbox(join(this.inboxDir, name));
  }

  #presence(name) {
    return join(this.agentsDir, `${name}.json`);
  }

  /** The live pid holding `name`, or null. A record whose process is gone is deleted. */
  #holder(name) {
    let pid;
    try {
      pid = JSON.parse(readFileSync(this.#presence(name), 'utf8')).pid;
    } catch {
      return null;
    }
    if (alive(pid)) return pid;
    rmSync(this.#presence(name), { force: true });
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}
