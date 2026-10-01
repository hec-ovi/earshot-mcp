# CONTRACT: bus

Version 0.2. A shared folder where agents find each other and leave messages. Plain files, no daemon. Works across processes and Docker containers that mount the same folder.

## In

- `new Bus(dir)`: the bus folder. Created when missing.

## Out

- `claim(name, owner, about?)`: takes a name for `owner` (any unique token) with a line on what it is good at. Names are 1-32 of `a-z 0-9 - _`. Claiming again as the same owner updates `about`.
- `beat(name, owner)`: keeps the name alive. Returns false when `owner` no longer holds it.
- `release(name, owner)`: frees the name if `owner` holds it.
- `online()`: live agents as `[{ name, about }]`, sorted by name.
- `post(from, to, text)`: queues a message for `to`, or for every other online agent when `to` is `*`. Returns `{ message, recipients }`.
- `queue(name)`: that name's message `Queue`.
- `Queue.put(message)`: queues a message in send order; a message taken and put back keeps its place.
- `Queue.take()`: removes and returns all queued messages, oldest first.
- `Queue.watch(onChange)`: calls `onChange` on file events and once a second. Returns `stop()`. Keeps no process alive.
- `BEAT_MS` (5000): how often a holder should beat. A name with no beat for 3 x `BEAT_MS` is gone.
- Message: `{ id, from, to, text, at }`, `at` is ISO 8601.

## Layout

```
<dir>/agents/<name>.json             { name, about, owner, since }, mtime is the last beat
<dir>/messages/<name>/<ms>-<id>.json one message, written then renamed into place
```

## Errors and invariants

- `claim` throws on an invalid name or a name another live owner holds. A record past its beat is removed on read.
- `post` throws when `to` is not online, listing who is.
- Only the owner takes from a queue. Messages wait in their queue until taken, across restarts.

## Depends on

Nothing.
