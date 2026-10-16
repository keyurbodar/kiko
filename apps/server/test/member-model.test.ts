import { describe, expect, test } from "bun:test"
import type { AgentSlug } from "@kiko/protocol"
import { DEFAULT_MODEL } from "../src/agent/factory"
import { type MemberRow, toMember } from "../src/room/members"

const row = (model: string): MemberRow => ({ slug: "ada" as AgentSlug, name: "ada", role: "", model, lead: true, status: "idle" })

describe("toMember model", () => {
  test("an agent with no model of its own reports the default", () =>
    expect(toMember(row("")).model).toBe(`${DEFAULT_MODEL.provider}/${DEFAULT_MODEL.modelId}`))
  test("an agent's own model wins", () => expect(toMember(row("opencode-go/deepseek-v4.1-flash")).model).toBe("opencode-go/deepseek-v4.1-flash"))
})
