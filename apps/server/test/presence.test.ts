import { expect, test } from "bun:test"
import { describeCall } from "../src/agent/extensions/presence"

// Architecture section 7.12: what the team board says about a tool call, and what it keeps quiet.
test("every kind of call reads as a few plain words; memory and team talk stay off the board", () => {
  expect(describeCall("executor_gmail_send", {})).toBe("using gmail send (connected apps)")
  expect(describeCall("executor_execute", { code: "..." })).toBe("running code on the human's connected apps")
  expect(describeCall("edit", { path: "/hello.html" })).toBe("editing /hello.html")
  expect(describeCall("read", { path: "notes/plan.md" })).toBe("reading /notes/plan.md")
  expect(describeCall("web_fetch", { url: "https://x.test" })).toBe("reading a web page")
  expect(describeCall("spawn_subagent", {})).toBe("working with a helper")
  expect(describeCall("some_new_tool", {})).toBe("using some new tool")
  for (const quiet of ["memory_write", "memory_search", "read_skill", "team", "send_message"]) expect(describeCall(quiet, {})).toBeNull()
})
