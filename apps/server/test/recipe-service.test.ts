import { expect, test } from "bun:test"
import type { RoomId } from "@kiko/protocol"
import { RecipeService } from "../src/user/recipe-service"
import { RecipeLibrary } from "../src/user/recipe-library"
import { Reminders } from "../src/user/reminders"
import { USER_STEPS } from "../src/user/schema"
import { parseRecipe } from "../src/recipes/recipe"
import { sqlWith } from "./sql-shim"

const roomId = "01J0000000000000000000000R" as RoomId
const rule = "FREQ=DAILY;BYHOUR=7;BYMINUTE=55"
const makeRecipe = (every = rule, run = "follow the tea-time skill.") => parseRecipe(`---\ntitle: Tea time\ndescription: Take a break.\nwhen: Daily\ntriggers:\n  - every: ${every}\n    run: ${run}\n---\nHave tea.`, "tea-time")

function setup() {
  const sql = sqlWith(USER_STEPS)
  for (const id of [roomId, "01J0000000000000000000000S"]) sql.exec("INSERT INTO chats (room_id, title, updated_at) VALUES (?, 'Test', 0)", id)
  let recipes = [makeRecipe()]
  let sha = "v1"
  const notices: string[] = []
  let inherited = ""
  const reminders = new Reminders(sql, { setWakeup: async () => {}, clearWakeup: async () => {}, dueWakeups: async () => [] }, async () => {})
  let service: RecipeService
  service = new RecipeService({
    sql,
    library: { read: async () => ({ recipes, broken: [], sha: new Map(recipes.map((r) => [r.slug, sha])) }) } as unknown as RecipeLibrary,
    timezone: async () => "UTC",
    createRoutine: async (input) => ({ ok: true, ...(await reminders.createRoutine("owner", input)) }),
    updateRoutine: async (id, patch) => {
      const out = await reminders.updateRoutine(id, patch)
      return out ? { ok: true, ...out } : { ok: false, error: "missing" }
    },
    cancelRoutine: async (id) => { await reminders.cancel(id); service.routineGone(id) },
    routine: (id) => reminders.get(id),
    chiefModel: async () => "provider/chosen-model",
    makeAgent: async (name, handle, description, model) => { inherited = model; return { id: "new-agent", name, slug: handle as never, prompt: description, model } },
    openChat: async () => "01J0000000000000000000000S" as RoomId,
    announce: async () => "delivered",
    notice: async (_, __, text) => { notices.push(text) },
  })
  return { sql, service, reminders, notices, inherited: () => inherited, edit: (next: typeof recipes) => { recipes = next; sha += "x" }, add: (agent = "yuki") => service.install({ installId: crypto.randomUUID(), slug: "tea-time", roomId, agent }) }
}

test("concurrent adds with different ids share one target; other agents get independent installs", async () => {
  const f = setup()
  const out = await Promise.all([f.add(), f.add(), f.add("ada")])
  expect(out.every((r) => r.ok)).toBe(true)
  expect((await f.service.list()).installs).toHaveLength(2)
  expect(f.reminders.list().filter((r) => r.status === "active")).toHaveLength(2)
  expect(out[1]).toMatchObject({ existed: true })
  for (const routine of f.reminders.list()) {
    expect(new Date(routine.dueUtc).getUTCHours()).toBe(7)
    expect(new Date(routine.dueUtc).getUTCMinutes()).toBe(55)
    expect(new Date(routine.dueUtc).getUTCSeconds()).toBe(0)
  }
  if (!out[0]?.ok) throw new Error("install failed")
  await f.service.uninstall(out[0].install.installId)
  expect((await f.service.list()).installs.map((i) => i.agent)).toEqual(["ada"])
  expect(f.reminders.list().filter((r) => r.status === "active").map((r) => r.target)).toEqual(["ada"])
  await f.add()
  expect((await f.service.list()).installs).toHaveLength(2)
})

test("file edits update defaults but preserve a routine's own schedule and instructions", async () => {
  const f = setup()
  await f.add()
  await f.add("ada")
  const ada = f.reminders.list().find((r) => r.target === "ada")!
  await f.reminders.updateRoutine(ada.id, { instructions: "my own briefing", trigger: { on: "time", at: new Date().toISOString(), rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0" } })
  f.edit([makeRecipe("FREQ=DAILY;BYHOUR=8;BYMINUTE=30", "new default")])
  await f.service.reconcile()
  expect(f.reminders.list().find((r) => r.target === "yuki")).toMatchObject({ text: "new default", rrule: "FREQ=DAILY;BYHOUR=8;BYMINUTE=30;BYSECOND=0" })
  expect(f.reminders.get(ada.id)).toMatchObject({ text: "my own briefing", rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0" })
})

test("missing files pause installs once; restoring resumes only the routines paused by the recipe", async () => {
  const f = setup()
  await f.add()
  await f.add("ada")
  const ada = f.reminders.list().find((r) => r.target === "ada")!
  await f.reminders.updateRoutine(ada.id, { status: "paused" })
  f.edit([])
  await f.service.reconcile()
  await f.service.reconcile()
  expect(f.reminders.list().map((r) => r.status)).toEqual(["paused", "paused"])
  expect(f.notices).toHaveLength(1)
  f.edit([makeRecipe()])
  await f.service.reconcile()
  expect(f.reminders.get(ada.id)?.status).toBe("paused")
  expect(f.reminders.list().find((r) => r.target === "yuki")?.status).toBe("active")
})

test("cancelling the last routine clears the install; always-on instructions are scoped to the target", async () => {
  const f = setup()
  await f.add()
  const routine = f.reminders.list()[0]!
  await f.reminders.cancel(routine.id)
  await f.service.reconcile()
  expect((await f.service.list()).installs).toHaveLength(0)
  const always = makeRecipe()
  always.triggers = []
  f.edit([always])
  const out = await f.add()
  expect(out.ok).toBe(true)
  expect((await f.service.briefs(roomId, "yuki"))[0]?.description).toContain("turned this on for you")
  expect((await f.service.briefs(roomId, "ada"))[0]?.description).not.toContain("turned this on for you")
  expect(await f.service.skillText("tea-time")).toContain("Have tea.")
})

test("its own chat inherits Kiko's selected model", async () => {
  const f = setup()
  expect((await f.service.install({ installId: crypto.randomUUID(), slug: "tea-time", own: true })).ok).toBe(true)
  expect(f.inherited()).toBe("provider/chosen-model")
})

test("listing exposes only each install's linked routines with their live schedule and status", async () => {
  const f = setup()
  await f.add()
  await f.add("ada")
  const ada = f.reminders.list().find((r) => r.target === "ada")!
  await f.reminders.updateRoutine(ada.id, { status: "paused", trigger: { on: "time", at: "2026-10-16T09:30:00Z", rrule: "FREQ=DAILY" } })
  await f.reminders.createRoutine("owner", { name: ada.name!, instructions: "unrelated routine", trigger: { on: "time", at: "2026-10-16T10:00:00Z", rrule: "FREQ=DAILY" }, tz: "UTC", roomId, target: "ada", createdBy: "human" })
  const listed = (await f.service.list()).installs
  expect(listed.find((i) => i.agent === "ada")?.routines).toEqual([{ id: ada.id, name: ada.name!, trigger: { on: "time", at: new Date(f.reminders.get(ada.id)!.dueUtc).toISOString(), rrule: "FREQ=DAILY" }, status: "paused", tz: "UTC", dueUtc: f.reminders.get(ada.id)!.dueUtc }])
  expect(listed.find((i) => i.agent === "yuki")?.routines).toHaveLength(1)
  expect(listed.find((i) => i.agent === "yuki")?.routines?.[0]?.status).toBe("active")
  expect(listed.find((i) => i.agent === "yuki")?.routines?.[0]?.id).not.toBe(ada.id)
})

test("deleted chats lose their installs and routines without affecting other chats", async () => {
  const f = setup()
  await f.add()
  await f.add("ada")
  const own = await f.service.install({ installId: crypto.randomUUID(), slug: "tea-time", own: true })
  if (!own.ok) throw new Error("install failed")
  f.sql.exec("DELETE FROM chats WHERE room_id = ?", roomId)
  const listed = await f.service.list()
  expect(listed.installs.map((i) => i.installId)).toEqual([own.install.installId])
  expect(f.reminders.list().filter((r) => r.status === "active").map((r) => r.roomId)).toEqual([own.install.roomId])
})

test("old installs recover their routines and cancel duplicate routines", async () => {
  const f = setup()
  const out = await f.add()
  if (!out.ok) throw new Error("install failed")
  f.sql.exec("DELETE FROM recipe_routines")
  const original = f.reminders.list()[0]!
  await f.reminders.createRoutine("owner", { name: original.name!, instructions: original.text, trigger: original.trigger!, tz: "UTC", roomId, target: "yuki", createdBy: "human" })
  await f.service.reconcile()
  expect(f.reminders.list().filter((r) => r.status === "active")).toHaveLength(1)
  await f.service.uninstall(out.install.installId)
  expect(f.reminders.list().filter((r) => r.status === "active")).toHaveLength(0)
})
