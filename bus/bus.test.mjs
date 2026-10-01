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
  const queue = bus.queue('beta');
  const [one, two] = queue.take();
  assert.deepEqual([one.from, one.text, two.text], ['alpha', 'one', 'two']);
  queue.put(two);
  queue.put(one);
  assert.deepEqual(queue.take().map((m) => m.text), ['one', 'two']);
  assert.deepEqual(queue.take(), []);
});

test('post to everyone skips the sender, post to nobody throws', () => {
  const bus = fresh();
  bus.claim('alpha', 'a');
  bus.claim('beta', 'b');
  assert.deepEqual(bus.post('alpha', EVERYONE, 'hi').recipients, ['beta']);
  assert.equal(bus.queue('alpha').take().length, 0);
  assert.throws(() => bus.post('alpha', 'gamma', 'hi'), /no agent "gamma" online. online: beta/);
});

test('watch fires when a message arrives', async () => {
  const bus = fresh();
  bus.claim('alpha', 'a');
  bus.claim('beta', 'b');
  const queue = bus.queue('beta');
  const keepAlive = setTimeout(() => {}, 5000);
  const arrived = new Promise((resolve) => {
    const stop = queue.watch(() => {
      const messages = queue.take();
      if (messages.length) {
        stop();
        resolve(messages[0].text);
      }
    });
  });
  bus.post('alpha', 'beta', 'ping');
  assert.equal(await arrived, 'ping');
  clearTimeout(keepAlive);
});

test('status says the folder is writable, who is online with their last beat, and what waits where', () => {
  const bus = fresh();
  bus.claim('alpha', 'a', 'web search');
  bus.claim('beta', 'b');
  bus.post('alpha', 'beta', 'one');
  bus.post('alpha', 'beta', 'two');
  bus.release('beta', 'b');
  const status = bus.status();
  assert.equal(status.writable, true);
  assert.deepEqual(status.agents.map(({ name, about }) => ({ name, about })), [{ name: 'alpha', about: 'web search' }]);
  assert.ok(status.agents[0].lastBeatMs >= 0 && status.agents[0].lastBeatMs < 5000);
  assert.deepEqual(status.queued, { beta: 2 });
  assert.equal(bus.queue('beta').size(), 2);
});
