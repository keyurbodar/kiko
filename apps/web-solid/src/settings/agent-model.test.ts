import { describe, expect, test } from "bun:test"
import type { AgentSlug, Member } from "@kiko/protocol"
import { answeringMember } from "./agent-model"

const member = (slug: string, lead = false): Member => ({ slug: slug as AgentSlug, name: slug, lead })
const group = [member("kiko", true), member("ada"), member("bo")]

describe("answeringMember", () => {
  test("an untagged draft goes to the lead", () => expect(answeringMember(group, "hello")?.slug as string).toBe("kiko"))
  test("a tag picks that agent", () => expect(answeringMember(group, "hey @bo can you look")?.slug as string).toBe("bo"))
  test("the first tag that names a member wins, and an unknown tag is skipped", () => expect(answeringMember(group, "@nobody @ada @bo")?.slug as string).toBe("ada"))
  test("an email address is not a tag", () => expect(answeringMember(group, "write to me@ada.com")?.slug as string).toBe("kiko"))
  test("a lone agent answers everything", () => expect(answeringMember([member("kiko", true)], "@ada hi")?.slug as string).toBe("kiko"))
})
