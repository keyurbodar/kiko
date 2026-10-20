import { expect, test } from "bun:test"
import { KIKO, type AgentSlug, type Chat, type RoomId } from "@kiko/protocol"
import { createAgent } from "../src/user/agents"
import { Reminders, type NewRoutine } from "../src/user/reminders"
import { createAgentRoutine, routineResult } from "../src/user/routines"
import { USER_STEPS } from "../src/user/schema"
import { sqlWith } from "./sql-shim"

const HOME = "01J0000000000000000000000A" as RoomId
const RADAR = "01J0000000000000000000000B" as RoomId
function world() {
  const sql = sqlWith(USER_STEPS)
  const agent = createAgent(sql, { id: "radar-id", slug: "radar" as AgentSlug, name: "Radar", prompt: "Research", model: "test" }, 1)!
  const chats: Chat[] = []
  const addChat = (roomId: RoomId, title: string, agents: readonly string[]) => {
    sql.exec("INSERT INTO room_directory (room_id) VALUES (?)", roomId)
    chats.push({ roomId, title, agents, pinned: false, muted: false, lastSeq: 0, lastPreview: "", unread: 0, updatedAt: 1 })
  }
  addChat(HOME, "Kiko", [KIKO])
  const reminders = new Reminders(sql, { sync: async () => {} }, Date.now)
  const create = (target: string) => createAgentRoutine({ name: "daily research", instructions: "Report findings", trigger: { on: "time", at: new Date(Date.now() + 3600000).toISOString(), rrule: "FREQ=DAILY" }, target, tz: "UTC", roomId: HOME, createdBy: KIKO }, {
    chat: async (id) => chats.find((chat) => chat.roomId === id) ?? null,
    agents: async () => [agent],
    openChat: async (title, agents) => {
      const existing = chats.find((chat) => JSON.stringify(chat.agents) === JSON.stringify(agents))
      if (existing) return { roomId: existing.roomId }
      addChat(RADAR, title, agents)
      return { roomId: RADAR }
    },
    create: (input: NewRoutine) => routineResult(() => reminders.createRoutine("owner", input)),
  })
  return { create, reminders, chats }
}

test("Kiko creates Radar's daily job in Radar's visible chat and reuses that chat", async () => {
  const { create, reminders, chats } = world()
  expect(await create("radar")).toMatchObject({ ok: true, routine: { target: "radar", roomId: RADAR, createdBy: KIKO } })
  expect(await create("radar")).toMatchObject({ ok: true, routine: { roomId: RADAR } })
  expect(reminders.list().every((r) => r.target === "radar" && r.roomId === RADAR)).toBe(true)
  expect(chats).toHaveLength(2)
})

test("a routine for the caller stays in its chat, and an unknown agent creates nothing", async () => {
  const { create, reminders, chats } = world()
  expect(await create(KIKO)).toMatchObject({ ok: true, routine: { target: KIKO, roomId: HOME } })
  expect(await create("missing")).toMatchObject({ ok: false, error: expect.stringContaining("no agent @missing") })
  expect(reminders.list()).toHaveLength(1)
  expect(chats).toHaveLength(1)
})
