import { describe, expect, test } from "bun:test"
import type { Agent, AgentSlug, Member } from "@yuki/protocol"
import { BUILTIN_AGENT } from "../lib/chats"
import { pickerMatches, toChips } from "./to-bar-model"

const agent = (slug: string, name = slug): Agent => ({ id: `id-${slug}`, name, slug: slug as AgentSlug, prompt: "", model: "" })
const member = (slug: string): Member => ({ slug: slug as AgentSlug, name: slug, lead: slug === "yuki" })
const ada = agent("ada", "ada lovelace")
const bob = agent("bob")
const all = [BUILTIN_AGENT, ada, bob]

describe("the to: chips", () => {
  const chips = (members: string[], over: { yukiOff?: boolean; empty?: boolean; chatAgents?: string[] } = {}) =>
    toChips({ members: members.map(member), chatAgents: over.chatAgents ?? [], agents: all, yukiOff: over.yukiOff ?? false, empty: over.empty ?? true }).map(
      (c) => `${c.slug}${c.removable ? " ×" : ""}`,
    )
  test.each<[string, string[], Parameters<typeof chips>[1], string[]]>([
    ["yuki alone in an empty chat can come off", ["yuki"], {}, ["yuki ×"]],
    ["yuki alone after a message stays", ["yuki"], { empty: false }, ["yuki"]],
    ["yuki taken off shows no chips", ["yuki"], { yukiOff: true }, []],
    ["in a group yuki stays and the others come off", ["yuki", "ada", "bob"], {}, ["yuki", "ada ×", "bob ×"]],
    ["before the room seeds, the chat's agents stand in", [], { chatAgents: ["yuki"] }, ["yuki ×"]],
    ["an agent id the user no longer has is skipped", [], { chatAgents: ["yuki", "id-gone"] }, ["yuki ×"]],
  ])("%s", (_, members, over, expected) => {
    expect(chips(members, over)).toEqual(expected)
  })
})

describe("the to: search", () => {
  const find = (inChat: string[], query: string) => pickerMatches(all, inChat, query).map((a) => a.slug as string)
  test.each<[string, string[], string, string[]]>([
    ["everyone not in the chat", ["yuki"], "", ["ada", "bob"]],
    ["by name", [], "love", ["ada"]],
    ["by handle", [], "bo", ["bob"]],
    ["@ searches handles only", [], "@love", []],
    ["@ with a handle", [], "@ada", ["ada"]],
    ["case folded", [], "ADA", ["ada"]],
    ["yuki comes back when it was taken off", [], "yuki", ["yuki"]],
  ])("%s", (_, inChat, query, expected) => {
    expect(find(inChat, query)).toEqual(expected)
  })
})
