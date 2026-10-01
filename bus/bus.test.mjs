import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Bus, EVERYONE } from './bus.mjs';

const DEAD_PID = 2 ** 31 - 2;
const fresh = () => new Bus(mkdtempSync(join(tmpdir(), 'earshot-bus-')));

test('claim, online and release', () => {
  const bus = fresh();
  bus.claim('alpha');
  bus.claim('alpha');
  bus.claim('beta', process.ppid);
  assert.deepEqual(bus.online(), ['alpha', 'beta']);
  bus.release('alpha');
  assert.deepEqual(bus.online(), ['beta']);
});

test('a live holder keeps its name, a dead one loses it', () => {
  const bus = fresh();
  bus.claim('alpha', process.ppid);
  assert.throws(() => bus.claim('alpha'), /taken/);
  writeFileSync(join(bus.agentsDir, 'ghost.json'), JSON.stringify({ name: 'ghost', pid: DEAD_PID }));
  assert.deepEqual(bus.online(), ['alpha']);
  bus.claim('ghost');
  assert.deepEqual(bus.online(), ['alpha', 'ghost']);
});

test('rejects invalid names', () => {
  assert.throws(() => fresh().claim('Bad Name'), /invalid name/);
});

test('post delivers in order, take empties the inbox', () => {
  const bus = fresh();
  bus.claim('alpha');
  bus.claim('beta', process.ppid);
  bus.post('alpha', 'beta', 'one');
  bus.post('alpha', 'beta', 'two');
  const inbox = bus.inbox('beta');
  assert.deepEqual(inbox.take().map((m) => [m.from, m.text]), [['alpha', 'one'], ['alpha', 'two']]);
  assert.deepEqual(inbox.take(), []);
});

test('post to everyone skips the sender, post to nobody throws', () => {
  const bus = fresh();
  bus.claim('alpha');
  bus.claim('beta', process.ppid);
  assert.deepEqual(bus.post('alpha', EVERYONE, 'hi').recipients, ['beta']);
  assert.equal(bus.inbox('alpha').take().length, 0);
  assert.throws(() => bus.post('alpha', 'gamma', 'hi'), /no agent "gamma" online. online: beta/);
});

test('watch fires when mail arrives', async () => {
  const bus = fresh();
  bus.claim('alpha');
  bus.claim('beta', process.ppid);
  const inbox = bus.inbox('beta');
  const keepAlive = setTimeout(() => {}, 5000);
  const arrived = new Promise((resolve) => {
    const stop = inbox.watch(() => {
      const mail = inbox.take();
      if (mail.length) {
        stop();
        resolve(mail[0].text);
      }
    });
  });
  bus.post('alpha', 'beta', 'ping');
  assert.equal(await arrived, 'ping');
  clearTimeout(keepAlive);
});
