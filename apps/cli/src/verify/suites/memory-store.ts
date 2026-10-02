import type { MemoryOp, MemoryRecord, MemoryResult } from "@kiko/protocol"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"

// Create a record with aliases, find it by an alias, edit it, and read the old version
// from history. Every call goes over the user socket, the way the memory screen does.
const suite: Suite = {
  name: "memory-store",
  async run(v) {
    const s = await v.as("alice")
    const user = await s.user()
    let n = 0
    const call = async (op: MemoryOp): Promise<MemoryResult> => {
      const reqId = `r${++n}`
      user.send({ t: "memory", reqId, op })
      const frame = await user.expect((f) => f.t === "memory_result" && f.reqId === reqId)
      return (frame as { result: MemoryResult }).result
    }
    const records = (r: MemoryResult): MemoryRecord[] => ("records" in r ? [...r.records] : [])
    const record = (r: MemoryResult): MemoryRecord => {
      if (!("record" in r) || !r.record) throw new VerifyError(`expected a record, got ${JSON.stringify(r)}`)
      return r.record
    }

    // A fresh title each run, so an earlier run's record cannot hide a bug.
    const title = `Margaret ${Date.now()}`
    const made = record(
      await call({ op: "create", type: "person", title, aliases: ["mum", "mother"], body: "- likes tea", author: "human" }),
    )

    const hits = records(await call({ op: "search", query: "mother" }))
    if (!hits.some((r) => r.id === made.id)) throw new VerifyError("searching an alias did not find the record")

    const edited = record(await call({ op: "replace", id: made.id, body: "- likes coffee", author: "human" }))
    expectEqual(edited.version, 2, "a replace bumps the version")

    const history = await call({ op: "history", id: made.id })
    if (!("versions" in history)) throw new VerifyError(`history answered ${JSON.stringify(history)}`)
    expectEqual(history.versions.map((x) => [x.version, x.body]), [[1, "- likes tea"]], "the old body is in history")

    const seen = record(await call({ op: "view", id: made.id }))
    expectEqual(seen.uses, 1, "view counts a use")
    expectEqual(
      records(await call({ op: "list" })).filter((r) => ["profile", "now", "todo"].includes(r.id)).length,
      3,
      "the three seed records exist",
    )
    await call({ op: "remove", id: made.id })
  },
}

export default suite
