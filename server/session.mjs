import { randomUUID } from 'node:crypto';
import { BEAT_MS } from '../bus/bus.mjs';

/**
 * One agent on the bus: its name, its inbox, and how its mail reaches it.
 * Mail goes to a pending `inbox` wait first, else to the doorbell when one is set, else stays queued
 * until the agent's next tool call. A doorbell that fails puts the message back and is dropped.
 */
export class Session {
  #owner = randomUUID();
  #name = null;
  #about = '';
  #inbox = null;
  #stop = null;
  #waiter = null;
  #doorbell = null;
  #ringing = Promise.resolve();

  constructor(bus) {
    this.bus = bus;
  }

  get joined() {
    return this.#name !== null;
  }

  /** `ring(message)` resolves true once the message is in the agent's conversation. */
  set doorbell(ring) {
    this.#doorbell = ring;
    this.#deliver();
  }

  join(name, about = '') {
    this.bus.claim(name, this.#owner, about);
    this.#about = about;
    if (name !== this.#name) {
      this.leave();
      this.#name = name;
      this.#inbox = this.bus.inbox(name);
      const stopWatch = this.#inbox.watch(() => this.#deliver());
      const beat = setInterval(() => this.#keepAlive(), BEAT_MS);
      beat.unref();
      this.#stop = () => {
        stopWatch();
        clearInterval(beat);
      };
    }
    return this.agents();
  }

  leave() {
    if (!this.#name) return;
    this.#stop();
    this.bus.release(this.#name, this.#owner);
    this.#name = this.#inbox = null;
  }

  send(to, text) {
    const { message, recipients } = this.bus.post(this.#joined(), to, text);
    return { id: message.id, to: recipients };
  }

  agents() {
    return { you: this.#name, online: this.bus.online().filter((a) => a.name !== this.#name) };
  }

  /** Queued mail, taken now. Empty before `join`, and while an `inbox` wait is pending (it gets the mail). */
  take() {
    return this.#inbox && !this.#waiter ? this.#inbox.take() : [];
  }

  /** Queued mail now, or the next mail within `seconds`, or `[]`. Ends early on abort. */
  inbox(seconds, signal) {
    this.#joined();
    const queued = this.take();
    if (queued.length || !seconds) return Promise.resolve(queued);
    this.#waiter?.([]);
    return new Promise((resolve) => {
      const done = (mail) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        if (this.#waiter === done) this.#waiter = null;
        resolve(mail);
      };
      const cancel = () => done([]);
      const timer = setTimeout(cancel, seconds * 1000);
      timer.unref();
      signal?.addEventListener('abort', cancel, { once: true });
      this.#waiter = done;
    });
  }

  #deliver() {
    if (!this.#inbox || (!this.#waiter && !this.#doorbell)) return;
    const mail = this.#inbox.take();
    if (!mail.length) return;
    if (this.#waiter) return this.#waiter(mail);
    for (const message of mail) this.#ringing = this.#ringing.then(() => this.#ring(message));
  }

  async #ring(message) {
    const ring = this.#doorbell;
    if (ring && (await ring(message).catch(() => false))) return;
    if (this.#doorbell === ring) this.#doorbell = null;
    this.#inbox?.put(message);
  }

  /** Refreshes presence, and claims the name again after a pause long enough to look gone (a laptop sleep). */
  #keepAlive() {
    try {
      this.bus.beat(this.#name, this.#owner) || this.bus.claim(this.#name, this.#owner, this.#about);
    } catch (err) {
      console.error(`earshot: ${err.message}`);
    }
  }

  #joined() {
    if (!this.#name) throw new Error('call join first: pick a name for yourself');
    return this.#name;
  }
}
