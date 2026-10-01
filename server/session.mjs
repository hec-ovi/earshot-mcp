/**
 * One agent on the bus: its name, its inbox, and where incoming mail goes.
 * Mail goes to a pending `wait` first, else to `push` when set, else stays queued on disk.
 */
export class Session {
  #name = null;
  #inbox = null;
  #stopWatch = null;
  #waiter = null;
  #pushing = Promise.resolve();

  /** `push(message)` delivers mail unasked (Claude Code channel); null means mail waits for `wait`. */
  constructor(bus, push = null) {
    this.bus = bus;
    this.push = push;
  }

  get name() {
    return this.#name;
  }

  join(name) {
    if (name !== this.#name) {
      this.bus.claim(name);
      this.leave();
      this.#name = name;
      this.#inbox = this.bus.inbox(name);
      this.#stopWatch = this.#inbox.watch(() => this.#deliver());
    }
    this.#deliver();
    return { name, online: this.bus.online().filter((n) => n !== name) };
  }

  leave() {
    if (!this.#name) return;
    this.#stopWatch();
    this.bus.release(this.#name);
    this.#name = null;
    this.#inbox = null;
  }

  send(to, text) {
    const { message, recipients } = this.bus.post(this.#joined(), to, text);
    return { id: message.id, to: recipients };
  }

  agents() {
    return { you: this.#name, online: this.bus.online().filter((n) => n !== this.#name) };
  }

  /** Resolves with queued mail, the next mail to arrive, or `[]` after `seconds` or on abort. */
  wait(seconds, signal) {
    this.#joined();
    const queued = this.#inbox.take();
    if (queued.length) return Promise.resolve(queued);
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
    if (!this.#inbox || (!this.#waiter && !this.push)) return;
    const mail = this.#inbox.take();
    if (!mail.length) return;
    if (this.#waiter) return this.#waiter(mail);
    for (const message of mail) {
      this.#pushing = this.#pushing.then(() => this.push(message)).catch((err) => console.error(`earshot: push failed: ${err.message}`));
    }
  }

  #joined() {
    if (!this.#name) throw new Error('call join first: pick a name for yourself');
    return this.#name;
  }
}
