import { expect, test } from "bun:test"
import { outputOf, stepOf } from "../src/agent/extensions/presence"

test("a step reads as past tense words the human can follow, and internal tools make none", () => {
  const label = (name: string, args: Record<string, unknown> = {}) => stepOf(name, args)?.label
  expect(label("read", { path: "plan.md" })).toBe("Read /plan.md")
  expect(label("edit", { path: "/plan.md" })).toBe("Edited /plan.md")
  expect(label("write", { path: "/a.md" })).toBe("Wrote /a.md")
  expect(label("ls", { path: "/drafts" })).toBe("Listed /drafts")
  expect(label("ls")).toBe("Listed the files")
  expect(label("bash", { command: "bun   test" })).toBe("Ran bun test")
  expect(label("web_fetch", { url: "https://example.com/a/b?x=1" })).toBe("Fetched example.com")
  expect(label("ask", { to: "@Ada" })).toBe("Asked ada")
  expect(label("linear_create_issue", { title: "x" })).toBe("Used linear_create_issue")
  for (const quiet of ["memory_write", "read_skill", "team", "send_message", "steer_work"]) expect(stepOf(quiet, {})).toBeNull()
  expect(stepOf("ask", {})).toBeNull()
  expect(stepOf("read", { path: "/a" })?.tool).toBe("read")
  expect(stepOf("bash", { command: "ls" })?.tool).toBe("run")
  expect(stepOf("web_fetch", {})?.tool).toBe("web")
  expect(stepOf("ask", { to: "ada" })?.tool).toBe("other")
})

test("a step keeps the whole input when the label shortens it, with keys removed and a cap", () => {
  const command = `curl -H "Authorization: Bearer abcdef123456" https://x.test && echo ${"x ".repeat(100)}`
  const step = stepOf("bash", { command })
  expect(step?.input).toContain("echo x x")
  expect(step?.input).not.toContain("abcdef123456")
  expect(step?.label).not.toContain("abcdef123456")
  expect(step?.label.length).toBeLessThan(90)
  expect(stepOf("bash", { command: `${"x ".repeat(2_000)}` })?.input?.length).toBeLessThanOrEqual(2_000)
  expect(stepOf("read", { path: "/a" })?.input).toBeUndefined()
  expect(stepOf("linear_create_issue", { title: "t", apiKey: "sk-abcdefghijklmnop" })?.input).toBe('{"title":"t","apiKey":"[hidden]"}')
  expect(stepOf("linear_create_issue", {})?.input).toBeUndefined()
})

test("a result becomes the output text, cut and without keys", () => {
  expect(outputOf([{ type: "text", text: "ok" }, { type: "image" }, { type: "text", text: "two" }])).toBe("ok\ntwo")
  expect(outputOf([{ type: "text", text: "token sk-abcdefghijklmnop here" }])).toBe("token [hidden] here")
  expect(outputOf([{ type: "text", text: "y ".repeat(5_000) }])?.length).toBe(4_000)
  expect(outputOf([])).toBeUndefined()
  expect(outputOf(undefined)).toBeUndefined()
})
