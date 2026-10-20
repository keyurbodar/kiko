// Test-only: a real OwnerDO on real SQLite whose physical alarm never reaches the runtime, so the
// test alone decides when an alarm happens.
import { OwnerDO } from "../src/owner/owner-do"
import type { Agent } from "../src/agent/agent-do"

type AlarmBox = { at: number | null; sets: number }

export type Seed = {
  agent: string
  room: string
  slug: string
  request: string
  readyAt: number
  version?: number
}

type Invocation = { agent: string; recovery: boolean; endedAt: number | null }

export type Snapshot = {
  alarmAt: number | null
  alarmSets: number
  invocations: Invocation[]
  reentries: number
  active: number
  maxActive: number
  runs: { agent: string; room_id: string; slug: string; request_id: string; version: number; ready_at: number }[]
  deadlines: { scope: string; at: number }[]
}

class FakeAgent {
  constructor(
    private readonly owner: TestOwner,
    private readonly key: string,
    private readonly roomId: string,
    private readonly slug: string,
  ) {}

  loaded(): boolean {
    return false
  }

  async busy(): Promise<boolean> {
    return false
  }

  scheduleRecovery(at: number): Promise<void> {
    this.owner.writeRecovery(this.key, at)
    return Promise.resolve()
  }

  async runInvocation(_due: () => boolean): Promise<"done"> {
    const record = this.owner.begin(this.key)
    try {
      // One awaited real SQLite read suspends the run, as a production invocation does.
      record.recovery = await this.owner.hasRecovery(this.key)
      if (this.owner.shouldReenter()) {
        this.owner.noteReentry()
        await this.owner.dispatchRun(this.roomId, this.slug)
      }
      if (this.owner.shouldFail()) throw new Error("fake invocation failed")
      this.owner.clearRecovery(this.key)
      record.endedAt = Date.now()
      return "done"
    } finally {
      this.owner.end()
    }
  }
}

export class TestOwner extends OwnerDO {
  private box!: AlarmBox
  private readonly fakes = new Map<string, FakeAgent>()
  private readonly invocations: Invocation[] = []
  private readonly mode = { fail: false, reenter: false }
  private active = 0
  private maxActive = 0
  private reentries = 0

  constructor(ctx: DurableObjectState, env: ConstructorParameters<typeof OwnerDO>[1]) {
    // A test decides when the alarm runs; the box only records what the clock asked for.
    const box: AlarmBox = { at: null, sets: 0 }
    Object.defineProperty(ctx.storage, "getAlarm", { configurable: true, value: async () => box.at })
    Object.defineProperty(ctx.storage, "setAlarm", {
      configurable: true,
      value: async (at: number | Date) => {
        box.at = typeof at === "number" ? at : at.getTime()
        box.sets++
      },
    })
    Object.defineProperty(ctx.storage, "deleteAlarm", { configurable: true, value: async () => { box.at = null } })
    super(ctx, env)
    this.box = box
  }

  protected override agent(roomId: string, slug: string): Agent {
    const key = `${roomId}:${slug}`
    let fake = this.fakes.get(key)
    if (!fake) {
      fake = new FakeAgent(this, key, roomId, slug)
      this.fakes.set(key, fake)
    }
    return fake as unknown as Agent
  }

  writeRecovery(key: string, at: number): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO owner_deadlines (scope, at) VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET at = excluded.at WHERE at IS NOT excluded.at",
      `agent:${key}`, at,
    )
  }

  async hasRecovery(key: string): Promise<boolean> {
    return this.ctx.storage.sql.exec<{ at: number }>("SELECT at FROM owner_deadlines WHERE scope = ?", `agent:${key}`).toArray().length > 0
  }

  clearRecovery(key: string): void {
    this.ctx.storage.sql.exec("DELETE FROM owner_deadlines WHERE scope = ?", `agent:${key}`)
  }

  begin(key: string): Invocation {
    const record: Invocation = { agent: key, recovery: false, endedAt: null }
    this.invocations.push(record)
    this.active++
    this.maxActive = Math.max(this.maxActive, this.active)
    return record
  }

  end(): void {
    this.active--
  }

  shouldFail(): boolean { return this.mode.fail }
  shouldReenter(): boolean { return this.mode.reenter }
  noteReentry(): void { this.reentries++ }

  async probeSeed(runs: Seed[], deadlines: { scope: string; at: number }[] = []): Promise<void> {
    const sql = this.ctx.storage.sql
    for (const run of runs) {
      sql.exec(
        `INSERT INTO owner_runs (agent, room_id, slug, request_id, ready_at, version) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(agent) DO UPDATE SET ready_at = excluded.ready_at, request_id = excluded.request_id, version = excluded.version`,
        run.agent, run.room, run.slug, run.request, run.readyAt, run.version ?? 1,
      )
    }
    for (const deadline of deadlines) {
      sql.exec("INSERT INTO owner_deadlines (scope, at) VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET at = excluded.at", deadline.scope, deadline.at)
    }
  }

  async probeConfigure(mode: { fail?: boolean; reenter?: boolean }): Promise<void> {
    this.mode.fail = mode.fail ?? false
    this.mode.reenter = mode.reenter ?? false
  }

  /** Runs the inherited alarm and reports its outcome instead of failing the RPC channel. */
  async probeWake(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.alarm()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async probeSnapshot(): Promise<Snapshot> {
    const sql = this.ctx.storage.sql
    return {
      alarmAt: this.box.at,
      alarmSets: this.box.sets,
      invocations: this.invocations.map((entry) => ({ ...entry })),
      reentries: this.reentries,
      active: this.active,
      maxActive: this.maxActive,
      runs: sql.exec<{ agent: string; room_id: string; slug: string; request_id: string; version: number; ready_at: number }>(
        "SELECT agent, room_id, slug, request_id, version, ready_at FROM owner_runs ORDER BY agent",
      ).toArray().map((row) => ({ ...row })),
      deadlines: sql.exec<{ scope: string; at: number }>("SELECT scope, at FROM owner_deadlines ORDER BY scope").toArray().map((row) => ({ ...row })),
    }
  }
}

export default {
  fetch() {
    return new Response("not found", { status: 404 })
  },
}
