import { describe, expect, it } from "vitest"
import type { Context } from "@earendil-works/chord"
import { InlineCodemodeSandbox, loadQuickJSWasm } from "@earendil-works/pi-codemode"
import type { JsonObject, NestedToolExecutionResult, ToolExecutionApi } from "@earendil-works/pi-durable"
import type { FilesBackend } from "../../files/room-fs"
import { RoomFs } from "../../files/room-fs"
import { CODEMODE, codemodeExtension } from "./codemode"

const encoder = new TextEncoder()
const wasm = loadQuickJSWasm()

function filesWith(seed: Record<string, string>): RoomFs {
  const entry = (path: string) => ({
    kind: "file" as const,
    path,
    id: path,
    size: encoder.encode(seed[path] ?? "").length,
    type: "text/plain",
    sha256: path,
    r2Key: path,
    at: 0,
  })
  const backend = {
    stat: async (path: string) => (path in seed ? entry(path) : null),
    list: async () => Object.keys(seed).map(entry),
    bytes: async (key: string) => encoder.encode(seed[key] ?? ""),
  } as unknown as FilesBackend
  return new RoomFs("test", backend)
}

function run(budget = 30_000) {
  const ext = codemodeExtension(
    async (options) => new InlineCodemodeSandbox({ ...options, wasm, interruptBudget: budget }),
  )
  const tool = ext.tools?.find((t) => t.name === CODEMODE)
  if (!tool) throw new Error("no codemode tool")
  const calls: { name: string; args: JsonObject }[] = []
  const answer = (name: string, args: JsonObject): NestedToolExecutionResult =>
    name === "fail"
      ? { taskId: "t" as never, isError: true, diagnostics: [{ severity: "error", message: "no such thing" }] as never }
      : { taskId: "t" as never, isError: false, diagnostics: [], structuredOutput: `${name}:${JSON.stringify(args)}` }
  const api = {
    conversationId: "c1",
    env: filesWith({
      "a.js":
        "function add(a, b) { return a + b }\nmodule.exports = { add }\nif (process.argv[2] === 'test') console.log('add ok', add(2, 3) === 5)\n",
    }),
    agent: async () => ({
      callable: [
        { name: "echo", description: "", parameters: {} },
        { name: "fail", description: "", parameters: {} },
      ],
    }),
    executeTool: async (name: string, args: JsonObject) => {
      calls.push({ name, args })
      return answer(name, args)
    },
  } as unknown as ToolExecutionApi
  const exec = async (code: string) => {
    const out = await tool.execute({ code } as never, api as never, {} as Context)
    const part = out.output?.[0]
    return { text: part?.type === "text" ? part.text : "", isError: out.isError === true }
  }
  return { exec, calls }
}

describe("codemode", () => {
  it("runs independent tool calls from one script and returns what it gathers", async () => {
    const { exec, calls } = run()
    const out = await exec(
      `const [a, b] = await Promise.all([tools.echo({ n: 1 }), tools.echo({ n: 2 })]); return a + " " + b`,
    )
    expect(out).toEqual({ text: expect.stringContaining('echo:{"n":1} echo:{"n":2}'), isError: false })
    expect(calls.map((c) => c.args.n)).toEqual([1, 2])
  })

  it("rejects in the script when a tool fails, with the tool's message", async () => {
    const { exec } = run()
    const out = await exec(`try { await tools.fail({}) } catch (e) { return "caught " + e.message }`)
    expect(out.text).toContain("caught no such thing")
  })

  it("runs a CommonJS file's test block", async () => {
    const { exec } = run()
    const out = await exec(`const module = { exports: {} }
new Function("module", "exports", "require", "process", await readText("/a.js"))(module, module.exports, () => ({}), { argv: ["node", "a.js", "test"] })
return Object.keys(module.exports)`)
    expect(out.text).toContain("add ok true")
    expect(out.text).toContain('["add"]')
  })

  it("keeps stored values for the next script in the conversation", async () => {
    const { exec } = run()
    await exec(`store("seen", 3)`)
    expect((await exec(`return load("seen") + 1`)).text).toContain("4")
  })

  it("stops a script that computes forever and says so", async () => {
    const { exec } = run(2_000)
    const out = await exec(`while (true) {}`)
    expect(out.isError).toBe(true)
    expect(out.text).toContain("Script timed out")
  })
})
