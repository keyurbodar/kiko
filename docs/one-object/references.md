# References

## Cloudflare

- Durable Objects limits: https://developers.cloudflare.com/durable-objects/platform/limits/
- Durable Objects pricing and free quotas: https://developers.cloudflare.com/durable-objects/platform/pricing/
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- WebSocket hibernation: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Alarms: https://developers.cloudflare.com/durable-objects/api/alarms/
- SQLite storage API: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- Index for agents: https://developers.cloudflare.com/workers/llms.txt and https://developers.cloudflare.com/llms.txt

### Free plan numbers this plan depends on

| Limit | Value | Notes |
|---|---|---|
| Durable Object requests | 100,000 a day | Includes RPC calls, alarms and socket messages. Incoming socket messages bill at 20:1; protocol pings are free |
| Awake time | 13,000 GB-s a day | Wall clock at 128 MB, shared by everything active in one object at once. 24 h is 11,059 GB-s |
| Rows written | 100,000 a day | `setAlarm` is 1 row. Deletes count. Every index updated counts |
| Rows read | 5,000,000 a day | |
| Storage | 5 GB per account, 1 GB per object | |
| CPU per invocation | 30 s for Durable Objects | 10 ms for a plain Worker request |
| Outgoing calls per invocation | 50 | 6 open at once |
| Alarm wall clock | 15 minutes | Failed alarms retry up to 6 times with backoff |
| Worker requests | 100,000 a day | Static assets are free unless `run_worker_first` matches them |
| Reset | 00:00 UTC | Going over fails that kind of operation until the reset |

## Code this plan touches

| Area | Files |
|---|---|
| Object classes | `apps/server/src/{room/room-do.ts,user/user-do.ts,agent/agent-do.ts,files/file-do.ts}`, `apps/server/wrangler.jsonc` |
| Names | `apps/server/src/lib/names.ts` |
| Agent host | `core/agent/src/{host.ts,inbox.ts,workers.ts,sqlite.ts,coalescing-storage.ts}` |
| Alarms | `core/durable/src/alarm.ts` |
| pi-durable storage | `@earendil-works/pi-durable/storage/{memory,sqlite}`, `Storage.commit` in its `types.d.ts` |
| Delivery between objects | `apps/server/src/room/{mail.ts,mail-drain.ts,wake.ts,wake-delivery.ts,burst.ts,burst-flush.ts,receive.ts,signals.ts,chat-touch.ts,open-tasks.ts}` |
| UserDO copies of rooms | `apps/server/src/user/{chats.ts,overview.ts,sockets.ts}` |
| Agent output | `apps/server/src/agent/{outbox.ts,step-batch.ts,retry.ts,stall.ts,run-error.ts}` |
| Timers | `apps/server/src/models/sync.ts`, `apps/server/src/user/{provider-watch.ts,memory-capture.ts,reminders.ts}`, `apps/server/src/room/memory-naps.ts` |
| Schemas | `apps/server/src/{room,user,agent}/schema.ts` |
| Client sockets | `apps/web-solid/src/sync/{socket.ts,user-channel.ts,room-store.ts,user-store.ts}` |
| Measuring | `apps/server/src/lib/dev-stats.ts`, `apps/cli/src/verify/suites/{overhead.ts,latency.ts}` |

## Commits referenced

- `7269f636` removed the memory capture try cap.
- `49ac8b4d` removed the overall stream deadline.
- `6823b8ec` added model retries.
- `e21a0548` set socket keepalive to 10 s and 5 s.
