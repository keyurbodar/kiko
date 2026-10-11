import { expect, test } from "bun:test"
import { describeCall, failed } from "../src/agent/extensions/presence"

test("every kind of call reads as a few plain words; memory and team talk stay off the board", () => {
  expect(describeCall("edit", { path: "/hello.html" })).toBe("editing /hello.html")
  expect(describeCall("read", { path: "notes/plan.md" })).toBe("reading /notes/plan.md")
  expect(describeCall("web_fetch", { url: "https://x.test" })).toBe("reading a web page")
  expect(describeCall("start_work", { task: "x" })).toBe("starting background work")
  expect(describeCall("some_new_tool", {})).toBe("using some new tool")
  expect(describeCall("bash", { command: "sed -i 's/a/b/'\n  /plan.md" })).toBe("running sed -i 's/a/b/' /plan.md")
  expect(describeCall("bash", { command: `grep -r todo ${"/notes ".repeat(20)}` })).toHaveLength(88)
  expect(describeCall("bash", {})).toBe("running a command on the files")
  for (const quiet of ["memory_write", "memory_search", "read_skill", "team", "send_message", "steer_work", "stop_work"]) expect(describeCall(quiet, {})).toBeNull()
})

test("a failed call names what failed and why, cut short, for the run's trace", () => {
  expect(failed("reading /flights.md", [{ type: "text", text: "no such file:\n/flights.md" }])).toBe("failed: reading /flights.md (no such file: /flights.md)")
  expect(failed("reading a web page", [{ type: "text", text: "x".repeat(200) }])).toBe(`failed: reading a web page (${"x".repeat(59)}…)`)
  expect(failed("reading a web page", [])).toBe("failed: reading a web page")
})
