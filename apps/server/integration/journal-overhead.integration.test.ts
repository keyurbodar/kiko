import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { startCdp } from "./cdp"
import { connect, type Counters, idle, type Owner, type Room, signIn, type StatementRow } from "./owner"
import { localWorker, localWorkerWith } from "./worker"

const QUIET_MS = 60_000
const ROW_GATE = 7
const WARM_RUNS = 5
const AGENT = "kiko"
const KINDS = ["owner", "agent", "room", "user", "file"] as const
const BROWSER_URLS = ["https://one.example/", "https://two.example/", "https://three.example/"]
const BROWSER_CLOSE_MS = 20_000

type AlarmAt = number | null | undefined

type Phase = {
  name: string
  counters: Counters
  statements: StatementRow[]
  billingVersion: number
  billableWrites: number
  sqlRows: number
  interObjectCalls: number
  setAlarmCalls: number
  armedAgent: AlarmAt
}

const sum = (counters: Counters, matches: (key: string) => boolean): number =>
  Object.entries(counters).reduce((total, [key, value]) => (matches(key) ? total + value : total), 0)

const rowsWritten = (counters: Counters): number =>
  counters["owner.rowsWritten"] ?? sum(counters, (key) => key.endsWith(".rowsWritten"))

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? NaN

const describeAlarm = (at: AlarmAt): string =>
  at === undefined ? "unknown" : at === null ? "none armed" : `armed for epoch ms ${at}`

const armedAlarm = (owner: Owner, room: Room) =>
  owner.post("api/dev/agent/status", { roomId: room.roomId, slug: AGENT }).pipe(
    Effect.map((body) => {
      const at = (body as { alarmAt?: unknown }).alarmAt
      return at === null || typeof at === "number" ? at : undefined
    }),
  )

const measure = (owner: Owner, name: string, room: Room) =>
  Effect.gen(function* () {
    const { counters, billingVersion = 0, statements = [] } = yield* owner.meter()
    const writes = (suffix: string) => sum(counters, (key) => key.endsWith(suffix))
    const sqlRows = rowsWritten(counters)
    const phase: Phase = {
      name,
      counters,
      statements,
      billingVersion,
      sqlRows,
      billableWrites: sqlRows + writes(".kvKeysPut") + writes(".kvKeysDeleted") + writes(".alarmWrites"),
      interObjectCalls: sum(
        counters,
        (key) => key.startsWith("rpc.") && key !== "rpc.owner" && !key.startsWith("rpc.owner."),
      ),
      setAlarmCalls: counters["owner.kv.setAlarm"] ?? writes(".kv.setAlarm"),
      armedAgent: yield* armedAlarm(owner, room),
    }
    const byKind = KINDS.map((kind) => `${kind} ${counters[`${kind}.rowsWritten`] ?? 0}`).join(", ")
    console.log(
      `${name}: billable writes ${phase.billableWrites}, SQL rows ${sqlRows} (${byKind}), setAlarm ${phase.setAlarmCalls}, agent alarm ${describeAlarm(phase.armedAgent)}`,
    )
    return phase
  })

const resetMeter = (owner: Owner) => owner.post("api/dev/stats/reset", {})

const quietMinute = (owner: Owner, name: string, room: Room) =>
  Effect.gen(function* () {
    yield* resetMeter(owner)
    yield* idle(QUIET_MS)
    return yield* measure(owner, name, room)
  })

const prompt = (room: Room, text: string, settleMs: number) =>
  Effect.gen(function* () {
    const mark = yield* room.mark()
    yield* room.send(`[reply] ${text}`)
    yield* room.untilMessage((messages) => messages.some((message) => message.text === text))
    yield* room.untilIdleAfter(mark)
    yield* idle(settleMs)
  })

const browseRound = (owner: Owner, room: Room) =>
  owner
    .post("api/dev/agent/browse", { roomId: room.roomId, slug: AGENT, urls: BROWSER_URLS })
    .pipe(Effect.map((body) => (body as { tabs?: unknown }).tabs))

const signedIn = Effect.gen(function* () {
  const worker = yield* localWorker
  const owner = yield* signIn(worker.url, "journal-overhead")
  const session = yield* connect(worker.url, owner.token)
  return { worker, owner, session }
})

const fakeRoom = (title: string) =>
  Effect.gen(function* () {
    const { worker, owner, session } = yield* signedIn
    const room = yield* session.newRoom(title)
    yield* owner.post("api/dev/agent/fake", { roomId: room.roomId })
    yield* prompt(room, "warm", 1_000)
    return { worker, owner, room }
  })

const browserRoom = (cdpUrl: string) =>
  Effect.gen(function* () {
    const worker = yield* localWorkerWith({ KERNEL_CDP: { type: "plain_text", value: cdpUrl } })
    const owner = yield* signIn(worker.url, "browser-overhead")
    const session = yield* connect(worker.url, owner.token)
    const room = yield* session.newRoom("browser overhead")
    yield* owner.post("api/dev/agent/fake", { roomId: room.roomId })
    yield* prompt(room, "warm", 1_000)
    return { owner, room }
  })

function assertQuiet(phase: Phase): void {
  assert.strictEqual(phase.billableWrites, 0, `${phase.name}: billable rows written`)
  assert.strictEqual(phase.setAlarmCalls, 0, `${phase.name}: setAlarm calls`)
  assert.strictEqual(phase.armedAgent, null, `${phase.name}: ${describeAlarm(phase.armedAgent)}`)
}

describe.concurrent("journal overhead", () => {
  it.live("keeps a warm prompt within the write budget and writes nothing in the quiet minute after it", () =>
    Effect.gen(function* () {
      const { owner, room } = yield* fakeRoom("journal overhead")
      const warmPrompts: Phase[] = []
      for (let sample = 1; sample <= WARM_RUNS; sample++) {
        yield* resetMeter(owner)
        yield* prompt(room, `one prompt ${sample}`, 300)
        warmPrompts.push(yield* measure(owner, `warm prompt ${sample}`, room))
      }
      const quiet = yield* quietMinute(owner, `quiet minute after the prompt (${QUIET_MS / 1000} s)`, room)

      const billable = median(warmPrompts.map((phase) => phase.billableWrites))
      const sqlRows = median(warmPrompts.map((phase) => phase.sqlRows))
      console.log(`gate: billable writes median ${billable}/${ROW_GATE} (SQL ${sqlRows})`)
      for (const phase of warmPrompts) {
        assert.property(phase.counters, "owner.rowsWritten", `${phase.name}: physical owner.rowsWritten counter`)
        assert.strictEqual(phase.billingVersion, 1, `${phase.name}: KV-key and setAlarm meters`)
      }
      assert.isAtMost(billable, ROW_GATE, `median billable rows across ${WARM_RUNS} warm prompts (${sqlRows} SQL)`)
      for (const phase of [...warmPrompts, quiet]) {
        assert.strictEqual(phase.interObjectCalls, 0, `${phase.name}: calls between objects`)
      }
      assertQuiet(quiet)
    }).pipe(Effect.scoped),
  )

  it.live("shows and persists exactly one error row for an always-failing prompt and then stays quiet", () =>
    Effect.gen(function* () {
      const { worker, owner, room } = yield* fakeRoom("journal overhead error")
      yield* resetMeter(owner)
      const mark = yield* room.mark()
      yield* room.send("[model-error] 429 rate limited")
      yield* room.untilMessage((messages) => messages.some((message) => message.event?.kind === "run_error"))
      yield* room.untilIdleAfter(mark)
      yield* idle(2_000)
      const failing = yield* measure(owner, "always-failing prompt", room)
      const quiet = yield* quietMinute(owner, `quiet minute after the error (${QUIET_MS / 1000} s)`, room)

      const live = yield* room.errorRows()
      const fresh = yield* connect(worker.url, owner.token)
      const persisted = yield* (yield* fresh.openRoom(room.roomId)).errorRows()
      console.log(`always-failing prompt: ${live} live error rows, ${persisted} on a fresh socket`)

      for (const phase of [failing, quiet]) {
        assert.strictEqual(phase.interObjectCalls, 0, `${phase.name}: calls between objects`)
      }
      assertQuiet(quiet)
      assert.strictEqual(live, 1, "error rows shown live")
      assert.strictEqual(persisted, 1, "error rows persisted")
    }).pipe(Effect.scoped),
  )
})

describe("browser overhead", () => {
  it.live("keeps a round of cloud browser reads within the write budget and idle quiet", () =>
    Effect.gen(function* () {
      const cdp = yield* Effect.acquireRelease(
        Effect.promise(() => startCdp()),
        (server) => Effect.promise(() => server.close()),
      )
      const { owner, room } = yield* browserRoom(cdp.url)
      const warm = yield* browseRound(owner, room)
      assert.strictEqual(warm, BROWSER_URLS.length, "the warm-up round read every page")
      yield* idle(1_000)

      const rounds: Phase[] = []
      for (let sample = 1; sample <= WARM_RUNS; sample++) {
        yield* resetMeter(owner)
        const tabs = yield* browseRound(owner, room)
        assert.strictEqual(tabs, BROWSER_URLS.length, `round ${sample} read every page`)
        rounds.push(yield* measure(owner, `browser round ${sample}`, room))
      }
      const billable = median(rounds.map((phase) => phase.billableWrites))
      const sqlRows = median(rounds.map((phase) => phase.sqlRows))
      console.log(`browser gate: billable writes median ${billable}/${ROW_GATE} (SQL ${sqlRows})`)
      assert.isAtMost(billable, ROW_GATE, `median billable rows across ${WARM_RUNS} browser rounds (${sqlRows} SQL)`)
      for (const phase of rounds) {
        assert.strictEqual(phase.interObjectCalls, 0, `${phase.name}: calls between objects`)
        assert.strictEqual(
          phase.statements.filter((row) => row.sql.startsWith("UPDATE kernel_lease")).length,
          0,
          `${phase.name}: kernel lease writes`,
        )
      }

      yield* idle(BROWSER_CLOSE_MS)
      const quiet = yield* quietMinute(owner, "quiet minute after the browser closed", room)
      assertQuiet(quiet)
    }).pipe(Effect.scoped),
  )
})
