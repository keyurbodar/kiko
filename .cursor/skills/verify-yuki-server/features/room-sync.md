# room-sync

Proves that a room stays in sync across devices: a room survives hibernation, a device that reconnects gets only what it missed, and reads are shared.

Suites: `room-sync` (room sockets, hibernation, resume), `user-sync` (user sockets, chat create and delete, replay), `turn` (one run across a burst and a server restart).

## Sub-features

- **room-sync**: a repeated send returns the same ack, and edit and react broadcast. The suite then idles 12 s (`YUKI_HIBERNATE_MS` changes only this wait; the server sets no idle timer, and workerd evicts after about 10 s) and checks the sockets still deliver. A laptop reconnects with `lastSeq` and receives only later events. A `read` at seq 6 is sent. A `hello` with `lastSeq` ahead of the log gets a full snapshot instead of a replay.
- **user-sync**: two devices (`a`, `b`) for one user. A chat created on `a` appears on `b`. A reconnect with a recent `lastSeq` replays the events after it. Deleting the two chats emits `chat_removed` on `b`.
- **turn**: three messages sent fast become one run. It checks that the live bubbles share one run and attempt, that their indexes run 0, 1, 2, and that the chat row was touched after the last bubble with a preview. With `YUKI_TURN_RESTART` (a shell command) it restarts the server mid-run, at the run's start or after its first bubble (`YUKI_TURN_RESTART_AT`), reconnects, and checks the same.

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
bun yuki verify turn --url http://localhost:8787
```

`room-sync` and `user-sync` are neither `model: true` nor `human: true`. `turn` is `model: true` and needs `OPENCODE_API_KEY` in the shell. All need a dev session. `YUKI_HIBERNATE_MS` changes only the suite's idle wait, not the server.

## Gotchas

- `room-sync` depends on workerd evicting an idle object. If the runtime keeps it awake, the hibernate check passes without proving hibernation. Say so in the evidence.
- The resumed socket uses `lastSeq: 4`. A replay that returns everything, not just events after 4, is a fail.
- `user-sync` waits for two `chat_removed` events. A missing one times out naming the match it waited for, not the event kinds it saw.
- A reconnect that is more than 500 events behind, or ahead of the log, gets a snapshot, not a replay. The suite checks the ahead case.
- `turn` only tests a clean run unless `YUKI_TURN_RESTART` is set, since it shells out to that command to restart the server mid-run. Run it alone.
