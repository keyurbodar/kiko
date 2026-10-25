import { describe, expect, it } from "vitest"
import { liveLabel } from "./run-log"

const step = (name: string, input?: string, label = `Used ${name}`) => ({
  tool: "other" as const,
  name,
  label,
  status: "done" as const,
  ...(input === undefined ? {} : { input }),
})

describe("liveLabel", () => {
  it("names the agent a deleted agent tool call removed", () => {
    expect(liveLabel(step("delete_agent", '{"handle":"ping"}'))).toBe("Deleted Ping")
  })

  it("says what a tool did when the server only knew its raw name", () => {
    expect(liveLabel(step("connect_app", '{"app":"gmail"}'))).toBe("Connected Gmail")
    expect(liveLabel(step("computer_read", '{"path":"/Users/me/notes.md"}'))).toBe("Read /Users/me/notes.md")
    expect(liveLabel(step("delete_group", '{"room_id":"r1"}'))).toBe("Deleted a group")
  })

  it("never shows a raw snake_case tool name", () => {
    expect(liveLabel(step("delete_agent"))).toBe("Deleted an agent")
    expect(liveLabel(step("mystery_tool", "{}"))).toBe("Used mystery tool")
  })

  it("keeps a label the server already wrote for people", () => {
    expect(liveLabel(step("create_task", '{"title":"x"}', "Added task x"))).toBe("Added task x")
  })

  it("puts a running humanized call in the present tense", () => {
    expect(liveLabel({ ...step("delete_agent", '{"handle":"ping"}'), status: "running" })).toBe("Deleting Ping")
  })
})
