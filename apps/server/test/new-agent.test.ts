import { expect, test } from "bun:test"
import type { Agent, AgentSlug, RoomId } from "@kiko/protocol"
import { BUILTIN_RECIPES } from "../src/recipes/catalog.gen"
import { matchRecipes } from "../src/recipes/match"
import { parseRecipe } from "../src/recipes/recipe"
import { soulFromDescription } from "../src/room/chief"
import { makeAgentChat, type NewAgentPorts } from "../src/room/new-agent"

const recipes = BUILTIN_RECIPES.map(([slug, text]) => parseRecipe(text, slug))
const roomId = "01JZ8Q4T6M0000000000000001" as RoomId

function fake(existing: Agent[] = []) {
  const agents = [...existing]
  const told: { roomId: RoomId; slug: string; text: string }[] = []
  const chats: { title: string; ids: readonly string[]; roomId?: RoomId }[] = []
  const ports: NewAgentPorts = {
    agents: async () => agents,
    make: async (spec) => {
      const agent = { id: spec.id ?? "generated", name: spec.name, slug: spec.handle as AgentSlug, prompt: spec.description, model: "" }
      agents.push(agent)
      return agent
    },
    openChat: async (title, ids, wanted) => {
      chats.push({ title, ids, roomId: wanted })
      return { roomId: wanted ?? roomId }
    },
    recipes: async (d) => matchRecipes(d, recipes),
    introduce: async (room, agent, text) => void told.push({ roomId: room, slug: agent.slug, text }),
  }
  return { ports, told, chats, agents }
}

const form = (description: string) => ({ name: "scout", handle: "scout", description, soul: soulFromDescription("Scout", description) })

test("the new agent form makes the agent, gives it the client's chat, and greets with the recipes that fit", async () => {
  const f = fake()
  const out = await makeAgentChat(f.ports, form("watches apartment listings and texts me new matches"), "human", { id: "id-1", roomId })
  if (!out.ok) throw new Error(out.error)
  await out.introduced
  expect(out.agent).toMatchObject({ id: "id-1", name: "Scout", slug: "scout" })
  expect(f.chats).toEqual([{ title: "Scout", ids: ["id-1"], roomId }])
  expect(f.told).toHaveLength(1)
  expect(f.told[0]).toMatchObject({ roomId, slug: "scout" })
  expect(f.told[0]!.text).toContain("the human just made you themselves")
  expect(f.told[0]!.text).toContain("Apartment hunter (apartment-hunter)")
  expect(f.told[0]!.text).toContain("speak first")
})

test("a description that matches no recipe adds no recipe list", async () => {
  const f = fake()
  const out = await makeAgentChat(f.ports, form("zzzz qqqq"), "human")
  if (!out.ok) throw new Error(out.error)
  await out.introduced
  expect(f.told[0]!.text).not.toContain("recipes")
})

test("a taken name or handle is refused and nothing is made", async () => {
  const f = fake([{ id: "a1", name: "Scout", slug: "scout" as AgentSlug, prompt: "", model: "" }])
  expect(await makeAgentChat(f.ports, form("anything"), "human")).toMatchObject({ ok: false, error: expect.stringContaining("already exists") })
  expect(await makeAgentChat(f.ports, { ...form("anything"), name: "Other" }, "human")).toMatchObject({ ok: false, error: expect.stringContaining("taken") })
  expect(f.chats).toEqual([])
  expect(f.told).toEqual([])
})

test("a repeat of the same form returns the agent made and greets nobody twice", async () => {
  const f = fake()
  const first = await makeAgentChat(f.ports, form("x"), "human", { id: "id-1", roomId })
  if (first.ok) await first.introduced
  const again = await makeAgentChat(f.ports, form("x"), "human", { id: "id-1", roomId })
  expect(again).toMatchObject({ ok: true, roomId })
  expect(f.agents).toHaveLength(1)
  expect(f.told).toHaveLength(1)
})

test("kiko's tool uses the same path and says kiko made the agent", async () => {
  const f = fake()
  const out = await makeAgentChat(f.ports, form("tracks my workouts"), "kiko")
  if (out.ok) await out.introduced
  expect(f.told[0]!.text).toContain("kiko just made you for the human")
})

test("recipes match by word overlap, best first, and nothing matches noise", () => {
  const got = matchRecipes("I want something that watches apartment listings", recipes)
  expect(got[0]?.slug).toBe("apartment-hunter")
  expect(matchRecipes("zzzz", recipes)).toEqual([])
  expect(matchRecipes("", recipes)).toEqual([])
})

test("the first soul is in the agent's own voice and fits the soul cap", () => {
  const soul = soulFromDescription("Scout", "x".repeat(500))
  expect(soul).toContain("i'm Scout")
  expect(soul).toContain("## what i've learned about working with them")
  expect(soul.length).toBeLessThan(3000)
})
