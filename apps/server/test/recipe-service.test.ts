import { expect, test } from "bun:test"
import type { RoomId } from "@kiko/protocol"
import { recipeCard } from "../src/recipes/card"
import { parseRecipe } from "../src/recipes/recipe"
import { agentNamed, createAgent } from "../src/user/agents"
import { RecipeLibrary } from "../src/user/recipe-library"
import { RecipeService } from "../src/user/recipe-service"
import { Reminders } from "../src/user/reminders"
import { USER_STEPS } from "../src/user/schema"
import { sqlWith } from "./sql-shim"

const roomId = "01J0000000000000000000000R" as RoomId
const rule = "FREQ=DAILY;BYHOUR=7;BYMINUTE=55"
const makeRecipe = (every = rule, run = "follow the tea-time skill.") => parseRecipe(`---\ntitle: Tea time\ndescription: Take a break.\nwhen: Daily\ntriggers:\n  - every: ${every}\n    run: ${run}\n---\nHave tea.`, "tea-time")

function setup() {
  const sql = sqlWith(USER_STEPS)
  for (const id of [roomId, "01J0000000000000000000000S"]) sql.exec("INSERT INTO chats (room_id, title, updated_at) VALUES (?, 'Test', 0)", id)
  let recipes = [makeRecipe()]
  let inherited = ""
  const reminders = new Reminders(sql, { setWakeup: async () => {}, clearWakeup: async () => {}, dueWakeups: async () => [] }, async () => {})
  const library = { read: async () => ({ recipes, custom: new Set<string>(), broken: [] }), edit: async () => null, retireSeeded: async () => {} } as unknown as RecipeLibrary
  let service: RecipeService
  service = new RecipeService({
    sql,
    library,
    timezone: async () => "UTC",
    createRoutine: async (input) => ({ ok: true, ...(await reminders.createRoutine("owner", input)) }),
    cancelRoutine: async (id) => {
      await reminders.cancel(id)
      service.routineGone(id)
    },
    routine: (id) => reminders.get(id),
    chiefModel: async () => "provider/chosen-model",
    agentNamed: (name) => agentNamed(sql, name),
    makeAgent: async (name, handle, description, model) => {
      inherited = model
      return createAgent(sql, { id: crypto.randomUUID(), name, slug: handle as never, prompt: description, model }, 0)
    },
    openChat: async () => "01J0000000000000000000000S" as RoomId,
    announce: async () => "delivered",
  })
  return {
    sql,
    service,
    reminders,
    inherited: () => inherited,
    setRecipes: (next: typeof recipes) => {
      recipes = next
    },
    add: (agent = "kiko") => service.install({ installId: crypto.randomUUID(), slug: "tea-time", roomId, agent }),
  }
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

test("an add returns the install with its routines", async () => {
  const f = setup()
  const out = await f.add()
  if (!out.ok) throw new Error("install failed")
  expect(out.install.routines).toHaveLength(1)
  expect(out.install.routines[0]).toMatchObject({ id: f.reminders.list()[0]!.id, status: "active", tz: "UTC" })
})

test("cancelling the last routine clears the install; always-on instructions are scoped to the target", async () => {
  const f = setup()
  await f.add()
  const routine = f.reminders.list()[0]!
  await f.reminders.cancel(routine.id)
  f.service.routineGone(routine.id)
  expect((await f.service.list()).installs).toHaveLength(0)
  const always = makeRecipe()
  always.triggers = []
  f.setRecipes([always])
  const out = await f.add()
  expect(out.ok).toBe(true)
  expect((await f.service.briefs(roomId, "kiko"))[0]?.description).toContain("turned this on for you")
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
  expect(listed.find((i) => i.agent === "kiko")?.routines).toHaveLength(1)
  expect(listed.find((i) => i.agent === "kiko")?.routines?.[0]?.status).toBe("active")
  expect(listed.find((i) => i.agent === "kiko")?.routines?.[0]?.id).not.toBe(ada.id)
})

test("deleted chats lose their installs and routines without affecting other chats", async () => {
  const f = setup()
  await f.add()
  await f.add("ada")
  const own = await f.service.install({ installId: crypto.randomUUID(), slug: "tea-time", own: true })
  if (!own.ok) throw new Error("install failed")
  await f.service.chatGone(roomId)
  const listed = await f.service.list()
  expect(listed.installs.map((i) => i.installId)).toEqual([own.install.installId])
  expect(f.reminders.list().filter((r) => r.status === "active").map((r) => r.roomId)).toEqual([own.install.roomId])
})

test("a card lists each app with its toolkit slug, and connected from the port or null when unknown", () => {
  const r = parseRecipe(`---\ntitle: Morning\ndescription: Mail.\nwhen: Daily\napps:\n  - Google Calendar\n  - Gmail\n---\nBody.`, "morning")
  const known = recipeCard(r, false, new Set(["gmail"]))
  expect(known.apps).toEqual([
    { name: "Google Calendar", slug: "googlecalendar", connected: false },
    { name: "Gmail", slug: "gmail", connected: true },
  ])
  expect(recipeCard(r, true, null).apps.map((a) => a.connected)).toEqual([null, null])
})

test("installing a recipe into its own chat twice reuses the agent, whatever the case of its name", async () => {
  const f = setup()
  const first = await f.service.install({ installId: crypto.randomUUID(), slug: "tea-time", own: true })
  const second = await f.service.install({ installId: crypto.randomUUID(), slug: "tea-time", own: true })
  expect(first.ok && second.ok).toBe(true)
  expect(second).toMatchObject({ existed: true })
  expect(f.sql.exec("SELECT count(*) AS n FROM agents").one().n).toBe(1)
  expect(f.reminders.list().filter((r) => r.status === "active")).toHaveLength(1)
  expect(createAgent(f.sql, { id: "x", name: " TEA time ", slug: "other" as never, prompt: "", model: "" }, 0)).toBeNull()
})
