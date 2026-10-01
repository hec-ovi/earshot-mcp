import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Bus, EVERYONE } from './bus.mjs';

const fresh = () => new Bus(mkdtempSync(join(tmpdir(), 'earshot-bus-')));

test('claim, online and release', () => {
  const bus = fresh();
  bus.claim('alpha', 'a', 'web search');
  bus.claim('alpha', 'a', 'web search, images');
  bus.claim('beta', 'b');
  assert.deepEqual(bus.online(), [{ name: 'alpha', about: 'web search, images' }, { name: 'beta', about: '' }]);
  bus.release('alpha', 'b');
  bus.release('beta', 'b');
  assert.deepEqual(bus.online().map((a) => a.name), ['alpha']);
});

test('a live holder keeps its name, a silent one loses it', () => {
  const bus = fresh();
  bus.claim('alpha', 'a');
  assert.throws(() => bus.claim('alpha', 'b'), /taken/);
  assert.equal(bus.beat('alpha', 'a'), true);
  utimesSync(join(bus.agentsDir, 'alpha.json'), 0, 0);
  assert.deepEqual(bus.online(), []);
  assert.equal(bus.beat('alpha', 'a'), false);
  bus.claim('alpha', 'b');
  assert.deepEqual(bus.online().map((a) => a.name), ['alpha']);
});

test('rejects invalid names', () => {
  assert.throws(() => fresh().claim('Bad Name', 'a'), /invalid name/);
});

test('post queues in order, take empties, put restores a place', () => {
  const bus = fresh();
  bus.claim('alpha', 'a');
  bus.claim('beta', 'b');
  bus.post('alpha', 'beta', 'one');
  bus.post('alpha', 'beta', 'two');
  const inbox = bus.inbox('beta');
  const [one, two] = inbox.take();
  assert.deepEqual([one.from, one.text, two.text], ['alpha', 'one', 'two']);
  inbox.put(two);
  inbox.put(one);
  assert.deepEqual(inbox.take().map((m) => m.text), ['one', 'two']);
  assert.deepEqual(inbox.take(), []);
});

test('post to everyone skips the sender, post to nobody throws', () => {
  const bus = fresh();
  bus.claim('alpha', 'a');
  bus.claim('beta', 'b');
  assert.deepEqual(bus.post('alpha', EVERYONE, 'hi').recipients, ['beta']);
  assert.equal(bus.inbox('alpha').take().length, 0);
  assert.throws(() => bus.post('alpha', 'gamma', 'hi'), /no agent "gamma" online. online: beta/);
});

test('watch fires when mail arrives', async () => {
  const bus = fresh();
  bus.claim('alpha', 'a');
  bus.claim('beta', 'b');
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
