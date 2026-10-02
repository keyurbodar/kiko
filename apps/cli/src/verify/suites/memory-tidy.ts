import type { MemoryOp, MemoryRecord, MemoryResult } from "@kiko/protocol"
import { tidyNow } from "../../commands/memory"
import { connectTestModel, expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"

// P5-03, architecture section 13.3. Seed two records that say the same thing and one record with
// a wrong fact and its correction. One tidy with the user's own model must leave one merged record,
// a dated correction, and the old bodies in history. A second tidy right after changes nothing.

const suite: Suite = {
  name: "memory-tidy",
  model: true,
  async run(v) {
    // A fresh user, so an earlier run's memory cannot answer for this one.
    const s = await v.as(`memtidy${Date.now()}`)
    await connectTestModel(s)
    const user = await s.user()
    let n = 0
    const call = async (op: MemoryOp): Promise<MemoryResult> => {
      const reqId = `t${++n}`
      user.send({ t: "memory", reqId, op })
      const frame = await user.expect((f) => f.t === "memory_result" && f.reqId === reqId)
      const result = (frame as { result: MemoryResult }).result
      if (!result.ok) throw new VerifyError(`${op.op} failed: ${result.error}`)
      return result
    }
    const all = async (): Promise<MemoryRecord[]> => {
      const r = await call({ op: "list", includeArchived: true })
      return "records" in r ? [...r.records] : []
    }
    const history = async (id: string) => {
      const r = await call({ op: "history", id })
      return "versions" in r ? r.versions : []
    }

    const seeds = [
      { id: "rex", type: "person", title: "rex", body: "- 2026-09-01: rex is the user's dog, a beagle (human)" },
      { id: "dog", type: "person", title: "the user's dog", body: "- 2026-09-03: the user has a beagle called rex (human)" },
      {
        id: "home",
        type: "conversation",
        title: "where the user lives",
        body: "- 2026-08-01: the user lives in boston (human)\n- 2026-09-20: the user moved to denver last month, so boston is wrong now (human)",
      },
    ] as const
    for (const r of seeds) await call({ op: "create", ...r, author: "human" })

    const first = await tidyNow(v.url, s.cookie)
    if (!first.ran) throw new VerifyError(`the first tidy did not run: ${JSON.stringify(first)}`)
    console.log(`first tidy: ${JSON.stringify(first)}`)

    const records = await all()
    const pair = records.filter((r) => r.id === "rex" || r.id === "dog")
    const kept = pair.filter((r) => !r.archived)
    if (kept.length !== 1) throw new VerifyError(`expected one merged record, got ${JSON.stringify(pair.map((r) => [r.id, r.archived, r.body]))}`)
    const merged = kept[0]!
    if (!/rex/i.test(merged.body) || !/beagle/i.test(merged.body)) throw new VerifyError(`the merged record lost a fact: ${merged.body}`)

    const home = records.find((r) => r.id === "home")!
    const lines = home.body.split("\n")
    if (!lines.some((l) => /^- \d{4}-\d{2}-\d{2}: .*denver/i.test(l))) throw new VerifyError(`no dated correction in: ${home.body}`)
    if (lines.some((l) => /boston/i.test(l) && !/denver/i.test(l))) throw new VerifyError(`the wrong fact is still stated: ${home.body}`)

    const old = await history("home")
    if (!old.some((x) => x.body === seeds[2].body)) throw new VerifyError("the old body of home is not in history")
    if (merged.version > 1) {
      const seed = seeds.find((x) => x.id === merged.id)!
      if (!(await history(merged.id)).some((x) => x.body === seed.body)) throw new VerifyError(`the old body of ${merged.id} is not in history`)
    }

    // Done when: a second run right after the first changes nothing.
    const second = await tidyNow(v.url, s.cookie)
    expectEqual(second.ran, false, "the second tidy ran")
    expectEqual(second.skipped, "unchanged", "the second tidy's reason")
    const after = await all()
    expectEqual(
      after.map((r) => [r.id, r.version, r.archived]),
      records.map((r) => [r.id, r.version, r.archived]),
      "memory after the second tidy",
    )
    console.log(`memory-tidy: merged into ${merged.id}, home is "${home.body.replace(/\n/g, " | ")}"`)
  },
}

export default suite
