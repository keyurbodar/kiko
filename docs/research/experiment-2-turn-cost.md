Result: experiment 2 settled for the agent side of a turn. Experiment 4 settled on 2026-10-04: a Durable Object on the Free plan is not held to 10 ms of CPU.

# Experiments 2 and 4: the cost of one turn

Questions (architecture section 21). Experiment 2: what does a turn cost in rows written, rows read, requests, CPU, and wall time? Experiment 4: does the Free plan's 10 ms CPU limit apply inside a Durable Object?

Run on 2026-10-02. Versions: `@earendil-works/pi-durable` 1.0.0, wrangler 4.146.0. Model `opencode-go/deepseek-v4.1-flash`. The prompt is the one from experiment 1 (the numbers from one to three hundred in words), so each turn streams about 15 seconds of output.

## Method

- Rows. `apps/server/src/experiments/count-rows.ts` wraps the storage handed to `openDurableObjectSqlite` and adds `cursor.rowsRead` and `cursor.rowsWritten` after every statement. `sqlite.ts` is not edited. It is on only when the variable `KIKO_DEBUG_ROWS=1` is set. Key-value `put` calls are not counted (the experiment writes 2 or 3 of them per turn). The counts split into `open` (migrations, one time) and `turn` (everything after).
- Requests, CPU, wall. Read from `wrangler tail --format json`. Each event has `cpuTime`, `wallTime`, and for a Durable Object invocation a `durableObjectId`. `kiko measure turn` sums the events of one run.
- Every run uses a fresh Durable Object (`?name=`), so no run reads an earlier run's history.
- Deployed run. A throwaway Worker `kiko-measure-p0-06` holding only `AgentDO` was deployed from `apps/server/measure-worker/`, measured, and deleted. The key was set as a secret and the secret went with the Worker.

## Output

Local, `wrangler dev` (no tail, so no CPU):

```text
$ bun kiko measure turn --runs 5 --url http://localhost:8806
run	rowsWritten	rowsRead	statements	openRowsWritten	openMs	wallMs
1	708	985	976	38	8	19951
2	853	1188	1179	38	9	25645
3	993	1384	1375	38	5	23601
4	723	1006	997	38	3	16893
5	1083	1510	1501	38	2	28375
mean	rowsWritten=872 rowsRead=1214.6 statements=1205.6 wallMs=22893
```

Deployed, heartbeat alarm on (what experiment 1 ships):

```text
$ bun kiko measure turn --runs 5 --url https://kiko-measure-p0-06.meroailabs.workers.dev --tail tail.jsonl
run	rowsWritten	rowsRead	statements	openRowsWritten	openMs	wallMs	requests	cpuMs	tailWallMs
1	813	1132	1123	38	0	17150	4	776	17985
2	933	1300	1291	38	0	23062	5	2233	24166
3	818	1139	1130	38	0	19020	4	2204	20001
4	1243	1734	1725	38	0	27838	4	2005	28768
5	873	1216	1207	38	0	20159	4	2055	21124
mean	rowsWritten=936 rowsRead=1304.2 statements=1295.2 requests=4.2 cpuMs=1854.6 wallMs=21445.8
```

Deployed, heartbeat alarm off (`KIKO_MEASURE_HEARTBEAT=0`). This is the cost of the turn itself and is the number section 17 uses:

```text
$ KIKO_MEASURE_HEARTBEAT=0 bun kiko measure turn --runs 5 --url https://kiko-measure-p0-06.meroailabs.workers.dev --tail tail.jsonl
run	rowsWritten	rowsRead	statements	openRowsWritten	openMs	wallMs	requests	cpuMs	tailWallMs
1	503	696	687	38	0	10738	2	1172	11726
2	668	927	918	38	0	14655	2	1521	15604
3	828	1151	1142	38	0	19670	2	1980	20757
4	773	1074	1065	38	0	18249	2	1735	19426
5	813	1130	1121	38	0	17608	2	1148	18556
mean	rowsWritten=717 rowsRead=995.6 statements=986.6 requests=2 cpuMs=1511.2 wallMs=16184
```

`requests` counts tail events: one Worker request and one Durable Object RPC call. With the heartbeat on it adds the alarm invocation and its cancelled twin.

## What the numbers say

- Rows written scale with streaming time, at about 40 rows per second (717 rows in 16 s deployed, 872 in 23 s locally). The 100 ms partial commits are the cause, at about 4 rows each once index rows are counted. The old estimate was 375 rows for 15 s. The measured number is about twice that.
- Opening a fresh object writes 38 rows once (migrations). It is not part of a turn.
- A turn reads about 1,000 rows. Reads are cheap on every plan, so they are not a limit.
- CPU is about 1.5 s per turn, spread over the one RPC call. That is 150 times the Free plan's 10 ms.
- The heartbeat in the experiment is not free. Its alarm fires 5 s into a live turn, calls `harness.resume()`, and shows 1.7 to 2.5 s of CPU in the tail while the turn is still running. The extra 220 rows written come with it. This is an artifact of the experiment, where the alarm does not check that the process is alive. The real host must not resume a run that is live. UNVERIFIED: whether the alarm's CPU is its own work or the turn's work counted twice.
- Wall time is 16 s, close to the 15 s that section 17 assumed.

## Experiment 4: the 10 ms limit

Settled on 2026-10-04. The limit does not apply inside a Durable Object on this account, and a plain Worker request is held to about 2 s, not 10 ms.

The plan. The account wrangler is signed in to is on the Free plan: deploying a Worker with `"limits": { "cpu_ms": 60000 }` fails with "CPU limits are not supported for the Free plan" (API code 100328). The earlier note in this file guessed it was not Free, because a 243 ms request succeeded. That guess was wrong: Free does not stop a request at 10 ms.

Method. `measure-worker/` deployed as `kiko-measure-p0-06`, then deleted. `/spin-worker?ms=N` burns CPU in the Worker, `/spin-do?ms=N` in a Durable Object, and `/quickjs-do?calls=N` starts an extension VM and runs N hook calls (`measure-worker/quickjs-probe.ts`). `cpuTime` and `outcome` come from `wrangler tail --format json`.

| Where | cpuTime | outcome |
| --- | --- | --- |
| Worker | 204 ms | ok |
| Worker | 1,308 ms | ok |
| Worker | 2,066 ms | exceededCpu (error 1102) |
| Durable Object | 539 ms | ok |
| Durable Object | 3,580 ms | ok |
| Durable Object | 9,887 ms | ok |
| Durable Object, cold QuickJS VM and 1 hook call | 17 ms | ok |
| Durable Object, QuickJS VM and 2,000 hook calls | not in the tail | ok (HTTP 200, 1.4 s wall) |

What it means. A turn (about 1.5 s of CPU) runs in `AgentDO` and fits. The Worker's own request handlers must stay under about 2 s. This is measured behavior, not the published limit, so it can change without notice.

## Experiment 5: subrequests and sustained CPU on Free

Measured on 2026-10-04 on the same Free account, with the same throwaway Worker (`measure-worker/`, deleted afterward).

| Probe | Result |
| --- | --- |
| 60 `fetch` calls in one Worker request | 50 pass, the 51st fails: "Too many subrequests by single Worker invocation" |
| 60 and 120 `fetch` calls in one Durable Object request | 50 pass, then the same error |
| 120 `fetch` calls in a Durable Object, continued after the request returned | 50 pass, then the same error |
| 120 RPC calls from a Durable Object to another object | all pass |
| 120 RPC calls, each making one `fetch` in the callee | all pass |
| 120 RPC calls to the object itself, each making one `fetch` | all pass |
| 150 `fetch` calls in the background, each through an RPC to the object itself | all pass |
| 6 Durable Object calls in a row at about 3.5 s of CPU each | all pass |
| 10 Worker requests in a row at about 1.3 s of CPU | 1 stopped (503, error 1102) |
| 20 Worker requests in a row at about 0.15 s of CPU | 3 stopped |

What it means: a run's work belongs to the invocation that started it, so outside requests go through a self-RPC to get their own budget. CPU-heavy work belongs in a Durable Object, never in a Worker handler or a queue consumer. Architecture section 17.3 has the decisions.
