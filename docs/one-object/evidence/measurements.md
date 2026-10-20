# Measurements

Taken on 2026-10-19 and 2026-10-20 against the production `kiko` Worker and a local dev server.

## How to rerun

```bash
CF_ACCOUNT=<account id> bash gql.sh cpu-and-rows.graphql.json   # CPU per invocation, rows and awake time by namespace
CF_ACCOUNT=<account id> bash gql.sh alarm-loop.graphql.json     # alarms per object in one minute
```

`gql.sh` uses the wrangler login and never prints the token. Run `bunx wrangler whoami` first if the token expired.

Namespaces: AgentDO `ef0036ea…`, RoomDO `e073d4a0…`, UserDO `68684a35…`.

## The outage, 2026-10-19

`wrangler tail kiko` showed `Exceeded allowed rows written in Durable Objects free tier.` on `/api/ws/user` and `/api/ws/room`.

| Object | Rows written that day |
|---|---|
| AgentDO | 85,845 |
| RoomDO | 11,557 |
| UserDO | 4,444 |

The account also hosts other projects that share the same free quotas.

Two idle AgentDOs, `2ac9f4ed…` and `5e779543…`, fired 4,837 and 4,836 alarms. That is about 10 a minute each, with no room, user or Worker traffic. The alarm times show delays of 1, 2, 4, 8 and 16 s, then a reset to 1 s. That's the catch block in `core/agent/src/host.ts`, whose in-memory `failures` count resets when the object is evicted. Each cycle writes about 4 rows, so the two objects together wrote about 115k rows a day.

## Cost per prompt, local, fake model

Counted with `/api/dev/stats` and the `overhead` suite helpers in `apps/cli/src/verify/suites/latency.ts`.

- About 140 rows written and 18 calls between objects per prompt: `touchChat` ×3, `chatTyping` ×2, and `draft` ×6 while streaming.
- 6 rows written in 2 idle minutes.
- One real agent in production, `85919eed`, wrote 48k rows over about 400 invocations.

## CPU and awake time, 2026-10-12 to 2026-10-20

| Object, kind | Invocations | CPU p50 | CPU p99 | CPU p99.9 |
|---|---|---|---|---|
| AgentDO alarm | 10,517 | 2.5 ms | 72 ms | 766 ms |
| AgentDO jsrpc | 1,973 | 18 ms | 218 ms | 692 ms |
| UserDO jsrpc | 24,108 | 0.4 ms | 4.8 ms | 35 ms |
| UserDO hibernation | 18,777 | 0.4 ms | 3.7 ms | 15 ms |
| RoomDO hibernation | 10,615 | 0.7 ms | 8.1 ms | 22 ms |

There were 0 `exceededCpuErrors` and 0 `exceededMemoryErrors`. On the free plan, Durable Objects get the 30 s CPU limit, not the Worker's 10 ms.

Awake time for the week was AgentDO 6,190, RoomDO 2,673 and UserDO 2,257 GB-s, about 1,600 GB-s a day, with almost no use.

## Endless retry loops found in the code

| Loop | Where | Cadence |
|---|---|---|
| Agent alarm failure | `core/agent/src/host.ts` catch block | 1 to 16 s, restarting at 1 s on eviction |
| Human message delivery | `room/burst-flush.ts:34`, `room/burst.ts:126` | 2 s |
| Agent-to-agent mail | `room/mail-drain.ts:92` | 2 s |
| Task wakes and reports | `room/wake-delivery.ts` (`DELIVERY_RETRY_MS`) | 2 s |
| Memory capture | `user/memory-capture.ts:183` | 60 s. Its cap of 5 tries was removed in 7269f636 |
| Room summaries without a model | `room/memory-naps.ts:65` | 10 min |
| A model stream that keeps trickling | `agent/stall.ts` | No overall deadline since 49ac8b4d |

Model retries in `agent/retry.ts` make up to 4 attempts with a 2 s base delay and ignore `Retry-After`.
