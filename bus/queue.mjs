import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const POLL_MS = 1000;

/** One agent's queue of message files, oldest first. Only its owner takes from it. */
export class Queue {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  /** Queues a message in send order. Putting back a taken message restores its place. */
  put(message) {
    const file = `${String(Date.parse(message.at)).padStart(15, '0')}-${message.id}.json`;
    writeFileSync(join(this.dir, `.${file}`), JSON.stringify(message));
    renameSync(join(this.dir, `.${file}`), join(this.dir, file));
  }

  /** Removes and returns every queued message, oldest first. */
  take() {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
      .sort()
      .map((f) => {
        const file = join(this.dir, f);
        const message = JSON.parse(readFileSync(file, 'utf8'));
        rmSync(file, { force: true });
        return message;
      });
  }

  /** Calls `onChange` when the queue may have changed. A slow poll backs up file events (bind mounts can miss them). Returns a stop function. */
  watch(onChange) {
    const watcher = watch(this.dir, onChange);
    const timer = setInterval(onChange, POLL_MS);
    watcher.unref();
    timer.unref();
    return () => {
      watcher.close();
      clearInterval(timer);
    };
  }
}
