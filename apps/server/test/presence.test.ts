import { expect, test } from "bun:test"
import { describeCall, failed, failedCall } from "../src/agent/extensions/presence"

const doing = (name: string, args: Record<string, unknown>) => describeCall(name, args)?.doing

test("every kind of call reads as a few plain words; memory and team talk stay off the board", () => {
  expect(doing("edit", { path: "/hello.html" })).toBe("editing /hello.html")
  expect(doing("read", { path: "notes/plan.md" })).toBe("reading /notes/plan.md")
  expect(doing("web_fetch", { url: "https://x.test" })).toBe("reading a web page")
  expect(doing("start_work", { task: "x" })).toBe("starting background work")
  expect(doing("some_new_tool", {})).toBe("using some new tool")
  expect(doing("bash", { command: "sed -i 's/a/b/'\n  /plan.md" })).toBe("running sed -i 's/a/b/' /plan.md")
  expect(doing("bash", { command: `grep -r todo ${"/notes ".repeat(20)}` })).toHaveLength(88)
  expect(doing("bash", {})).toBe("running a command on the files")
  for (const quiet of ["memory_write", "memory_search", "read_skill", "team", "send_message", "steer_work", "stop_work"]) expect(describeCall(quiet, {})).toBeNull()
})

test("a call carries a typed activity, so the client never reads the words", () => {
  const kind = (name: string, args: Record<string, unknown> = {}) => describeCall(name, args)?.activity
  expect(kind("read", { path: "a" })).toEqual({ kind: "tool", tool: "read", caption: "reading /a" })
  expect(kind("ls")).toMatchObject({ tool: "search" })
  expect(kind("edit", { path: "a" })).toMatchObject({ tool: "edit" })
  expect(kind("write", { path: "a" })).toMatchObject({ tool: "edit" })
  expect(kind("bash", { command: "ls" })).toMatchObject({ tool: "run" })
  expect(kind("web_fetch")).toMatchObject({ tool: "web" })
  expect(kind("create_routine")).toMatchObject({ tool: "other" })
  expect(kind("some_new_tool")).toMatchObject({ tool: "other" })
})

test("asking a teammate shows as waiting on them, not as silence", () => {
  expect(describeCall("ask", { to: "@Ben", question: "which port?" })).toEqual({ doing: "waiting on @ben", activity: { kind: "waiting", on: "ben" } })
  expect(describeCall("ask", {})).toBeNull()
})

test("a failed call keeps its tool words and says what failed", () => {
  const read = describeCall("read", { path: "flights.md" })!
  expect(failedCall(read, [{ type: "text", text: "no such file" }])).toEqual({
    doing: "failed: reading /flights.md (no such file)",
    activity: { kind: "failed", caption: "failed: reading /flights.md (no such file)" },
  })
})

test("a failed call names what failed and why, cut short, for the run's trace", () => {
  expect(failed("reading /flights.md", [{ type: "text", text: "no such file:\n/flights.md" }])).toBe("failed: reading /flights.md (no such file: /flights.md)")
  expect(failed("reading a web page", [{ type: "text", text: "x".repeat(200) }])).toBe(`failed: reading a web page (${"x".repeat(59)}…)`)
  expect(failed("reading a web page", [])).toBe("failed: reading a web page")
})
