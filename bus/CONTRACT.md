# CONTRACT: bus

Version 0.1. A shared folder where agents on one machine find each other and leave messages. Plain files, no daemon.

## In

- `new Bus(dir)`: the bus folder. Created when missing.

## Out

- `claim(name, pid?)`: takes a name for a process (default: this one). Names are 1-32 of `a-z 0-9 - _`. Claiming a name you hold is a no-op.
- `release(name, pid?)`: frees the name if that process holds it.
- `online()`: sorted names held by live processes.
- `post(from, to, text)`: queues a message for `to`, or for every other online agent when `to` is `*`. Returns `{ message, recipients }`.
- `inbox(name)`: that name's `Inbox`.
- `Inbox.take()`: removes and returns all queued messages, oldest first.
- `Inbox.watch(onMail)`: calls `onMail` on file events and once a second. Returns `stop()`. Keeps no process alive.
- Message: `{ id, from, to, text, at }`, `at` is ISO 8601.

## Layout

```
<dir>/agents/<name>.json        { name, pid, since }
<dir>/inbox/<name>/<ms>-<id>.json   one message, written then renamed into place
```

## Errors and invariants

- `claim` throws on an invalid name or a name a live process holds. A record whose process is gone is stale and replaced.
- `post` throws when `to` is not online, listing who is.
- Only the owner reads an inbox. Messages for a name wait in its inbox until taken, across restarts.

## Depends on

Nothing.
