import { expect, test } from "bun:test"
import { outputOf, stepOf } from "../src/agent/extensions/presence"
import { composioDescribe } from "../src/integrations/composio/step"
import { toolName } from "../src/integrations/composio/tools"

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
  expect(label("mkdir", { path: "trip" })).toBe("Made folder /trip")
  expect(label("mv", { from: "/a.md", to: "b.md" })).toBe("Moved /a.md to /b.md")
  expect(label("rm", { paths: ["/a.md"] })).toBe("Deleted /a.md")
  expect(label("rm", { paths: ["/a.md", "/b.md"] })).toBe("Deleted files")
  expect(label("create_task", { title: "Buy JR passes" })).toBe("Added task Buy JR passes")
  expect(label("note", { text: "window seats" })).toBe("Saved a note")
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

test("a connected app's call reads as the app and the action, from the tool's own slug", () => {
  const tools = [
    { name: "GMAIL_SEND_EMAIL", inputSchema: {}, direct: { slug: "GMAIL_SEND_EMAIL", toolkit: "gmail" } },
    { name: "COMPOSIO_MULTI_EXECUTE_TOOL", inputSchema: {} },
    { name: "COMPOSIO_SEARCH_TOOLS", inputSchema: {} },
    { name: "COMPOSIO_REMOTE_WORKBENCH", inputSchema: {} },
  ]
  const describe = composioDescribe(tools)
  expect(stepOf(toolName("GMAIL_SEND_EMAIL"), { to: "a@b.c" }, describe)).toMatchObject({ label: "Send email", app: "gmail", name: "composio_gmail_send_email", tool: "other" })
  const many = { tools: [{ tool_slug: "GOOGLECALENDAR_CREATE_EVENT", arguments: {} }, { tool_slug: "GMAIL_FETCH_EMAILS", arguments: {} }] }
  expect(stepOf(toolName("COMPOSIO_MULTI_EXECUTE_TOOL"), many, describe)).toMatchObject({ label: "Create event and 1 more", app: "googlecalendar" })
  expect(stepOf(toolName("COMPOSIO_SEARCH_TOOLS"), { queries: [] }, describe)?.label).toBe("Searched connected apps")
  expect(stepOf(toolName("COMPOSIO_REMOTE_WORKBENCH"), {}, describe)).toMatchObject({ label: "Remote workbench", app: "composio" })
  expect(stepOf("read", { path: "/a" }, describe)?.app).toBeUndefined()
})

test("a result becomes the output text, cut and without keys", () => {
  expect(outputOf([{ type: "text", text: "ok" }, { type: "image" }, { type: "text", text: "two" }])).toBe("ok\ntwo")
  expect(outputOf([{ type: "text", text: "token sk-abcdefghijklmnop here" }])).toBe("token [hidden] here")
  expect(outputOf([{ type: "text", text: "routine 01a1481c-e1eb-75a9-afd0-68d6ec82c2c4 set, key a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7" }])).toBe("routine 01a1481c-e1eb-75a9-afd0-68d6ec82c2c4 set, key [hidden]")
  expect(outputOf([{ type: "text", text: "y ".repeat(5_000) }])?.length).toBe(4_000)
  expect(outputOf([])).toBeUndefined()
  expect(outputOf(undefined)).toBeUndefined()
})
