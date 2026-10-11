# room-sync

Proves that a room stays in sync across devices: a room survives hibernation, a device that reconnects gets only what it missed, and reads are shared.

Suites: `room-sync` (room sockets, hibernation, resume), `user-sync` (user sockets, chat create and delete, replay).

## Sub-features

- **room-sync**: a room socket hibernates after about 12 s idle (`YUKI_HIBERNATE_MS`, default 12000); sockets stay open. A laptop reconnects with `lastSeq` and receives only later events. A `read` at seq 6 is sent.
- **user-sync**: two devices (`a`, `b`) for one user. A chat created on `a` appears on `b`. A reconnect with a recent `lastSeq` replays the events after it. Deleting the two chats emits `chat_removed` on `b`.

## How to get to it (user POV)

1. Sign in on two browsers as the same user.
2. Create a chat on one; it appears on the other.
3. Leave the room idle for a minute. Send a message; it still arrives on both.
4. Close one browser, send messages, reopen it. The missed messages appear.
5. Delete a chat on one device; it disappears on the other.

## Driving it with the yuki CLI

```bash
bun yuki verify room-sync --url http://localhost:8787
bun yuki verify user-sync --url http://localhost:8787
```

Neither suite is `model: true`. Set `YUKI_HIBERNATE_MS` only when debugging; the default is the real eviction window.

## Gotchas

- `room-sync` depends on workerd evicting an idle object. If the runtime keeps it awake, the hibernate check passes without proving hibernation. Say so in the evidence.
- The resumed socket uses `lastSeq: 4`. A replay that returns everything, not just events after 4, is a fail.
- `user-sync` waits for two `chat_removed` events. A missing one times out with the event kinds seen so far.
