import { expect, test } from "bun:test"
import type { AgentSlug, WorkerRow } from "@kiko/protocol"
import { Team } from "../src/room/team"
import { ROOM_STEPS } from "../src/room/schema"
import { activityOf, agentStatuses, statusOf, workersKey } from "../src/room/status"
import { sqlWith } from "./sql-shim"

const ada = "ada" as AgentSlug
const bob = "bob" as AgentSlug
const w = (status: WorkerRow["status"]): WorkerRow => ({ id: "w1", task: "t", status, step: null, steps: 0, startedAt: 1 })

test("activity is what the member is doing, then writing, then background work, then nothing", () => {
	expect(activityOf("idle", { kind: "writing" }, [w("running")])).toBeUndefined()
	expect(activityOf("typing", { kind: "tool", tool: "read", caption: "reading /a" }, [])).toEqual({ kind: "tool", tool: "read", caption: "reading /a" })
	expect(activityOf("typing", null, [])).toEqual({ kind: "writing" })
	expect(activityOf("working", null, [w("running"), w("done")])).toEqual({ kind: "background", workers: [w("running")] })
	expect(activityOf("working", null, [w("done")])).toBeUndefined()
})

function room() {
	const sql = sqlWith(ROOM_STEPS)
	for (const [slug, lead] of [[ada, 1], [bob, 0]] as const) {
		sql.exec("INSERT INTO members (slug, name, role, model, lead, status, added_seq) VALUES (?, ?, '', '', ?, 'idle', 1)", slug, slug, lead)
	}
	return { sql, team: new Team(sql) }
}

test("the snapshot lists every member that is not idle, with its typed activity", () => {
	const { sql, team } = room()
	expect(agentStatuses(sql)).toEqual([])
	sql.exec("UPDATE members SET status = 'typing' WHERE slug = ?", ada)
	team.doing(ada, "waiting on @bob", 1, { kind: "waiting", on: bob })
	sql.exec("UPDATE members SET status = 'working' WHERE slug = ?", bob)
	sql.exec("INSERT INTO meta (key, value) VALUES (?, ?)", workersKey(bob), JSON.stringify([w("running")]))
	expect(agentStatuses(sql)).toEqual([
		{ slug: ada, state: "typing", doing: "waiting on @bob", activity: { kind: "waiting", on: bob } },
		{ slug: bob, state: "working", activity: { kind: "background", workers: [w("running")] } },
	])
	expect(statusOf(sql, bob)?.state).toBe("working")
	sql.exec("UPDATE members SET status = 'idle' WHERE slug = ?", ada)
	expect(agentStatuses(sql).map((s) => s.slug)).toEqual([bob])
})

test("clearing what a member is doing drops its caption and activity but keeps its leases", () => {
	const { sql, team } = room()
	sql.exec("UPDATE members SET status = 'working' WHERE slug = ?", ada)
	team.doing(ada, "editing /a", 1, { kind: "tool", tool: "edit", caption: "editing /a" })
	team.take(ada, ["a"], 1)
	team.clearDoing(ada)
	expect(statusOf(sql, ada)).toEqual({ slug: ada, state: "working" })
	expect(team.held(ada, 2)).toEqual(["a"])
})
