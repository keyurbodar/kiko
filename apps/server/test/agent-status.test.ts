import { expect, test } from "bun:test"
import type { WorkerRow } from "@kiko/protocol"
import { activityOf } from "../src/room/status"

const w = (status: WorkerRow["status"]): WorkerRow => ({ id: "w1", task: "t", status, step: null, steps: 0, startedAt: 1 })

test("activity is what the member is doing, then writing, then background work, then nothing", () => {
	expect(activityOf("idle", { kind: "writing" }, [w("running")])).toBeUndefined()
	expect(activityOf("typing", { kind: "tool", tool: "read", caption: "reading /a" }, [])).toEqual({ kind: "tool", tool: "read", caption: "reading /a" })
	expect(activityOf("typing", null, [])).toEqual({ kind: "writing" })
	expect(activityOf("working", null, [w("running"), w("done")])).toEqual({ kind: "background", workers: [w("running")] })
	expect(activityOf("working", null, [w("done")])).toBeUndefined()
})
