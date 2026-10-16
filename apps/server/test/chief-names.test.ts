import { expect, test } from "bun:test"
import type { Agent, AgentSlug } from "@kiko/protocol"
import { checkGroup, checkNewAgent } from "../src/room/chief"

const pollen: Agent = { id: "a1", name: "Pollen", slug: "pollen" as AgentSlug, prompt: "", model: "" }
const spec = (name: string, handle: string) => ({ name, handle, description: "d", soul: "# s\nbe kind" })
const kiko = "kiko" as AgentSlug

test("a new agent with a name an agent already has is refused, ignoring case and spaces", () => {
  for (const name of ["pollen", " POLLEN ", "Kiko"]) {
    expect(checkNewAgent(spec(name, "fresh"), [pollen])).toMatchObject({ error: expect.stringContaining("already exists") })
  }
  expect(checkNewAgent(spec("Bee", "bee"), [pollen])).toMatchObject({ name: "Bee" })
})

test("a new agent's name starts with a capital, whatever case the model wrote", () => {
  expect(checkNewAgent(spec("ebert", "ebert"), [])).toMatchObject({ name: "Ebert" })
})

test("only kiko passes new agents to a group, and a group needs a kickoff", () => {
  const group = { title: "Trip", members: ["pollen"], newAgents: [spec("Bee", "bee")], goal: "plan", kickoff: "go" }
  expect(checkGroup(group, kiko, [pollen])).toMatchObject({ newAgents: [{ name: "Bee" }] })
  expect(checkGroup(group, "pollen" as AgentSlug, [pollen])).toMatchObject({ error: expect.stringContaining("only kiko") })
  expect(checkGroup({ ...group, newAgents: [], kickoff: "  " }, kiko, [pollen])).toMatchObject({ error: expect.stringContaining("kickoff") })
})

test("the creator is not a pick, so a group of the creator alone is refused", () => {
  const solo = { title: "Trip", members: ["pollen", "kiko"], newAgents: [], goal: "", kickoff: "go" }
  expect(checkGroup(solo, "pollen" as AgentSlug, [pollen])).toMatchObject({ error: expect.stringContaining("at least one agent") })
})
