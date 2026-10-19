import { expect, test } from "bun:test"
import { canManageRoutine } from "../src/agent/routine-access"
import type { AgentHome } from "../src/room/home"
import type { Reminder } from "../src/user/reminders"

const origin = "01J00000000000000000000000" as AgentHome["roomId"]
const radarChat = "01J00000000000000000000001" as AgentHome["roomId"]
const routine = { roomId: radarChat, target: "radar" } as Reminder
const caller = (slug: string, roomId = origin) => ({ slug: slug as AgentHome["slug"], roomId })

test("Kiko can manage a routine after routing it into Radar's chat", () => {
  expect(canManageRoutine(caller("kiko"), routine)).toBe(true)
})
test("the assigned agent can manage its routine from any chat", () => {
  expect(canManageRoutine(caller("radar"), routine)).toBe(true)
})
test("room teammates can manage its routines; unrelated agents cannot", () => {
  expect(canManageRoutine(caller("writer", radarChat), routine)).toBe(true)
  expect(canManageRoutine(caller("writer"), routine)).toBe(false)
})
