import type { AgentSlug } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { Team } from "./team"

const KIKO = "kiko" as AgentSlug

const team = () => new Team({} as SqlStorage, "room")

describe("Team.writing", () => {
  it("replaces a finished tool's words with writing a reply", () => {
    const t = team()
    t.doing(KIKO, "using slow tool", 1, { kind: "tool", tool: "other", caption: "using slow tool" })
    t.writing(KIKO, undefined, 2)
    expect(t.now(KIKO)).toBe("writing a reply")
    expect(t.activity(KIKO)).toEqual({ kind: "writing" })
  })

  it("keeps a retry detail until the retry ends", () => {
    const t = team()
    t.writing(KIKO, "retrying, attempt 2", 1)
    t.writing(KIKO, undefined, 2)
    expect(t.now(KIKO)).toBe("retrying, attempt 2")
    t.writing(KIKO, null, 3)
    expect(t.now(KIKO)).toBe("writing a reply")
  })
})
