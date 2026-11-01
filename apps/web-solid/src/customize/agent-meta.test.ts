import { describe, expect, it } from "vitest"
import { agentMetaLine } from "./agent-meta"

describe("agentMetaLine", () => {
  it("joins what is known with a middle dot", () => {
    expect(agentMetaLine({ model: "Claude Sonnet 5.5", tools: 3, memory: true })).toBe(
      "Claude Sonnet 5.5 · 3 tools · Memory on",
    )
  })

  it("counts one tool in the singular", () => {
    expect(agentMetaLine({ tools: 1 })).toBe("1 tool")
  })

  it("leaves out anything the client does not know", () => {
    expect(agentMetaLine({})).toBeUndefined()
    expect(agentMetaLine({ model: "Claude Haiku 5.5", memory: false })).toBe("Claude Haiku 5.5 · Memory off")
    expect(agentMetaLine({ memory: undefined })).toBeUndefined()
  })
})
