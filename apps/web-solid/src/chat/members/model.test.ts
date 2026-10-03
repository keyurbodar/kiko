import { describe, expect, test } from "bun:test"
import type { Agent, AgentSlug, Member } from "@kiko/protocol"
import { addable, addOp, refusalText, renameOp, roleLabel } from "./model"

const agent = (slug: string, extra: Partial<Agent> = {}): Agent => ({ id: `id-${slug}`, name: slug, slug: slug as AgentSlug, prompt: "", model: "", ...extra })
const member = (slug: string, extra: Partial<Member> = {}): Member => ({ slug: slug as AgentSlug, name: slug, lead: false, ...extra })

describe("member list model", () => {
  test("only agents not in the room can be added, in the user's order", () => {
    expect(addable([agent("kiko"), agent("piko"), agent("ada")], [member("piko")]).map((a) => String(a.slug))).toEqual(["kiko", "ada"])
  })

  test("an add carries the agent's tagline as its role and its model, and leaves out what is empty", () => {
    expect(addOp(agent("ada", { name: "Ada", prompt: "reviews code. strict about tests.\nsecond line", model: "opencode-go/x" }))).toEqual({
      op: "add",
      slug: "ada" as AgentSlug,
      name: "Ada",
      role: "reviews code.",
      model: "opencode-go/x",
    })
    expect(addOp(agent("kiko"))).toEqual({ op: "add", slug: "kiko" as AgentSlug, name: "kiko" })
  })

  test.each([
    ["a new name renames", "pika", { op: "rename", slug: "piko", name: "pika" }],
    ["spaces around it are dropped", "  pika ", { op: "rename", slug: "piko", name: "pika" }],
    ["the same name sends nothing", "piko", null],
    ["an empty name sends nothing", "   ", null],
  ] as const)("%s", (_name, input, want) => expect(renameOp(member("piko"), input)).toEqual(want as never))

  test.each([
    ["limit", { op: "add", slug: "ada", name: "Ada" }, "a group holds at most 8 agents"],
    ["exists", { op: "add", slug: "ada", name: "Ada" }, "ada is already in this chat"],
    ["unknown", { op: "remove", slug: "ada" }, "ada is not in this chat"],
    ["last", { op: "remove", slug: "ada" }, "a chat keeps at least one agent"],
    ["reserved", { op: "add", slug: "all", name: "all" }, "@all is a reserved handle"],
  ] as const)("a %s refusal says why", (reason, op, want) => expect(refusalText(op as never, reason)).toBe(want))

  test.each([
    ["the lead", member("kiko", { lead: true, role: "plans" }), "lead"],
    ["a role's first line", member("ada", { role: "Reviews code\nand more" }), "reviews code"],
    ["no role", member("piko"), "agent"],
  ] as const)("%s", (_name, m, want) => expect(roleLabel(m)).toBe(want))
})
