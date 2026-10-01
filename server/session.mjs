import { randomUUID } from 'node:crypto';
import { BEAT_MS } from '../bus/bus.mjs';

/**
 * One agent on the bus: its name, its message queue, and how its messages reach it.
 * A message goes to a pending `messages` wait first, else to the doorbell when one is set, else stays queued
 * until the agent's next tool call. A doorbell that fails puts the message back and is dropped.
 */
export class Session {
  #owner = randomUUID();
  #name = null;
  #about = '';
  #queue = null;
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
      this.#queue = this.bus.queue(name);
      const stopWatch = this.#queue.watch(() => this.#deliver());
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
    this.#name = this.#queue = null;
  }

  send(to, text) {
    const { message, recipients } = this.bus.post(this.#joined(), to, text);
    return { id: message.id, to: recipients };
  }

  agents() {
    return { you: this.#name, online: this.bus.online().filter((a) => a.name !== this.#name) };
  }

  /** This agent and the bus: its name, how its messages reach it now, and the bus status. Works before `join`. */
  health() {
    const delivery = !this.#name ? 'not joined' : this.#waiter ? 'messages wait' : (this.#doorbell?.kind ?? 'with tool results');
    return { you: this.#name, delivery, ...this.bus.status() };
  }

  /** Queued messages, taken now. Empty before `join`, and while a `messages` wait is pending (it gets them). */
  take() {
    return this.#queue && !this.#waiter ? this.#queue.take() : [];
  }

  /** Queued messages now, or the next ones within `seconds`, or `[]`. Ends early on abort. */
  messages(seconds, signal) {
    this.#joined();
    const queued = this.take();
    if (queued.length || !seconds) return Promise.resolve(queued);
    this.#waiter?.([]);
    return new Promise((resolve) => {
      const done = (messages) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        if (this.#waiter === done) this.#waiter = null;
        resolve(messages);
      };
      const cancel = () => done([]);
      const timer = setTimeout(cancel, seconds * 1000);
      timer.unref();
      signal?.addEventListener('abort', cancel, { once: true });
      this.#waiter = done;
    });
  }

  #deliver() {
    if (!this.#queue || (!this.#waiter && !this.#doorbell)) return;
    const messages = this.#queue.take();
    if (!messages.length) return;
    if (this.#waiter) return this.#waiter(messages);
    for (const message of messages) this.#ringing = this.#ringing.then(() => this.#ring(message));
  }

  async #ring(message) {
    const ring = this.#doorbell;
    if (ring && (await ring(message).catch(() => false))) return;
    if (this.#doorbell === ring) this.#doorbell = null;
    this.#queue?.put(message);
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
