import { mkdirSync, readdirSync, readFileSync, rmSync, watch } from 'node:fs';
import { join } from 'node:path';

const POLL_MS = 1000;

/** One agent's queue of message files, oldest first. Only its owner reads it. */
export class Inbox {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
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

  /** Calls `onMail` when the inbox may have changed. A slow poll backs up file events. Returns a stop function. */
  watch(onMail) {
    const watcher = watch(this.dir, onMail);
    const timer = setInterval(onMail, POLL_MS);
    watcher.unref();
    timer.unref();
    return () => {
      watcher.close();
      clearInterval(timer);
    };
  }
}
