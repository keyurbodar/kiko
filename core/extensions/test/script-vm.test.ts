import { beforeAll, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import type { ExtensionBundle } from "@kiko/protocol"
import { ScriptVM } from "@kiko/sandbox/vm"

let wasm: WebAssembly.Module

beforeAll(async () => {
  wasm = await WebAssembly.compile(readFileSync(require.resolve("quickjs-wasi/quickjs.wasm")))
})

const bundle = (source: string, files: Record<string, string> = {}): ExtensionBundle => ({
  manifest: { kiko: 1, name: "t", version: "1.0.0", description: "t", tools: { go: { description: "go", effect: "read" } } },
  files: { "main.js": source, ...files },
})

const noBridge = () => {
  throw new Error("no bridge")
}

test("runs an exported tool with json arguments and returns json", async () => {
  const vm = await ScriptVM.create(bundle(`export const tools = { go: async ({ n }) => ({ doubled: n * 2, words: "a-b".split("-") }) }`), wasm)
  expect(vm.shape.tools).toEqual(["go"])
  expect(await vm.invoke({ group: "tools", name: "go" }, [{ n: 21 }], {}, noBridge)).toEqual({ doubled: 42, words: ["a", "b"] })
  vm.dispose()
})

test("the bridge carries calls out and answers back in", async () => {
  const seen: unknown[] = []
  const vm = await ScriptVM.create(
    bundle(`export const tools = { go: async (_a, kiko) => {
      const tasks = await kiko.call("list_tasks", { status: "done" })
      await kiko.state.set("count", tasks.length)
      kiko.log("counted", tasks.length)
      return "posted " + tasks.length + " for " + kiko.env.agent
    } }`),
    wasm,
  )
  const out = await vm.invoke({ group: "tools", name: "go" }, [{}], { agent: "ada" }, async (op, payload) => {
    seen.push([op, ...payload])
    return op === "call" ? [{ title: "a" }, { title: "b" }] : undefined
  })
  expect(out).toBe("posted 2 for ada")
  expect(seen).toEqual([
    ["call", "list_tasks", { status: "done" }],
    ["state.set", "count", 2],
    ["log", ["counted", "2"]],
  ])
  vm.dispose()
})

test("a refused bridge call becomes an error the script can catch", async () => {
  const vm = await ScriptVM.create(bundle(`export const tools = { go: async (_a, kiko) => { try { await kiko.fetch("https://x.test") } catch (e) { return "caught: " + e.message } } }`), wasm)
  expect(await vm.invoke({ group: "tools", name: "go" }, [{}], {}, async () => Promise.reject(new Error("fetch is not allowed here")))).toBe("caught: fetch is not allowed here")
  vm.dispose()
})

test("an infinite loop is stopped and the vm still works", async () => {
  const vm = await ScriptVM.create(bundle(`export const tools = { go: async ({ spin }) => { if (spin) { while (true) {} } return "ok" } }`), wasm)
  await expect(vm.invoke({ group: "tools", name: "go" }, [{ spin: true }], {}, noBridge)).rejects.toThrow("ran too long")
  expect(await vm.invoke({ group: "tools", name: "go" }, [{ spin: false }], {}, noBridge)).toBe("ok")
  vm.dispose()
})

test("running out of memory fails the call and retires the vm", async () => {
  const vm = await ScriptVM.create(bundle(`export const tools = { go: async () => { const a = []; while (true) a.push("x".repeat(100000)) } }`), wasm)
  await expect(vm.invoke({ group: "tools", name: "go" }, [{}], {}, noBridge)).rejects.toThrow()
  expect(vm.unusable).toBe(true)
  vm.dispose()
})

test("the sandbox has no fetch, timers, process, or wasm, and cannot reach the raw host functions", async () => {
  const vm = await ScriptVM.create(
    bundle(`export const tools = { go: async () => [typeof fetch, typeof setTimeout, typeof process, typeof WebAssembly, typeof __host, typeof __hostSync, typeof require] }`),
    wasm,
  )
  expect(await vm.invoke({ group: "tools", name: "go" }, [{}], {}, noBridge)).toEqual(["undefined", "undefined", "undefined", "undefined", "undefined", "undefined", "undefined"])
  vm.dispose()
})

test("the prelude's helpers are not reachable from the script", async () => {
  const names = ["host", "hostSync", "ask", "makeKiko", "pick", "parse"]
  const vm = await ScriptVM.create(bundle(`export const tools = { go: async () => [${names.map((n) => `typeof ${n}`).join(", ")}] }`), wasm)
  expect(await vm.invoke({ group: "tools", name: "go" }, [{}], {}, noBridge)).toEqual(names.map(() => "undefined"))
  vm.dispose()
})

test("a retired vm finishes the call that is running and is disposed after", async () => {
  const vm = await ScriptVM.create(bundle(`export const tools = { go: async (_a, kiko) => (await kiko.state.get("k")) + "!" }`), wasm)
  let release: (v: string) => void = () => {}
  const running = vm.invoke({ group: "tools", name: "go" }, [{}], {}, () => new Promise((r) => (release = r)))
  await new Promise((r) => setTimeout(r, 20))
  vm.retire()
  release("still alive")
  expect(await running).toBe("still alive!")
  await expect(vm.invoke({ group: "tools", name: "go" }, [{}], {}, noBridge)).rejects.toThrow("stopped working")
})

test("imports resolve inside the bundle only", async () => {
  const vm = await ScriptVM.create(bundle(`import { shout } from "./lib/text.js"; export const tools = { go: async ({ s }) => shout(s) }`, { "lib/text.js": `export const shout = (s) => s.toUpperCase() + "!"` }), wasm)
  expect(await vm.invoke({ group: "tools", name: "go" }, [{ s: "hi" }], {}, noBridge)).toBe("HI!")
  vm.dispose()
  await expect(ScriptVM.create(bundle(`import x from "https://evil.test/x.js"; export const tools = {}`), wasm)).rejects.toThrow("not in the extension")
})

test("a syntax error at load is reported as one line", async () => {
  await expect(ScriptVM.create(bundle(`export const tools = { go: async () => { return ( }`), wasm)).rejects.toThrow(/SyntaxError/)
})

test("kiko outlives its call only as a refusal", async () => {
  const vm = await ScriptVM.create(
    bundle(`let saved; export const tools = { keep: async (_a, kiko) => { saved = kiko; return "kept" }, use: async () => { try { await saved.state.get("x"); return "used" } catch (e) { return e.message } } }`),
    wasm,
  )
  await vm.invoke({ group: "tools", name: "keep" }, [{}], {}, async () => "v")
  expect(await vm.invoke({ group: "tools", name: "use" }, [{}], {}, async () => "v")).toContain("this call has ended")
  vm.dispose()
})

test("each bridge call carries its own op and arguments, even when calls overlap and memory churns", async () => {
  const vm = await ScriptVM.create(
    bundle(`export const tools = { go: async (_a, kiko) => {
      const out = await Promise.all(Array.from({ length: 40 }, (_, i) => { const junk = "x".repeat(5000 + i); return kiko.state.get("k" + i + junk.slice(0, 0)) }))
      const a = await kiko.fetch("https://api.example.com/a")
      const b = await kiko.call("list_tasks", { n: 2 })
      return [out.length, out[39], a, b]
    } }`),
    wasm,
  )
  const seen: string[] = []
  const out = await vm.invoke({ group: "tools", name: "go" }, [{}], {}, async (op, payload) => {
    await Promise.resolve()
    seen.push(`${op}:${JSON.stringify(payload)}`)
    return `${op}|${payload[0]}`
  })
  expect(out).toEqual([40, "state.get|k39", "fetch|https://api.example.com/a", "call|list_tasks"])
  expect(seen.filter((s) => s.startsWith("state.get:")).length).toBe(40)
  expect(seen).toContain('fetch:["https://api.example.com/a",{}]')
  vm.dispose()
})

test("a vm that grew past the retire size takes no new calls, and the pool starts a fresh one", async () => {
  const { VmPool } = await import("@kiko/sandbox/compile")
  const installed = { name: "t", hash: "h1", bundle: bundle(`let keep = []; export const tools = { go: async ({ grow }) => { if (grow) for (let i = 0; i < 9000; i++) keep.push("x".repeat(1000)); return keep.length } }`) }
  const pool = new VmPool(() => wasm)
  const first = await pool.get(installed)
  expect(first.memoryBytes).toBeLessThan(4 * 1024 * 1024)
  expect(await first.invoke({ group: "tools", name: "go" }, [{ grow: true }], {}, noBridge)).toBe(9000)
  expect(first.unusable).toBe(true)
  const second = await pool.get(installed)
  expect(second).not.toBe(first)
  expect(await second.invoke({ group: "tools", name: "go" }, [{ grow: false }], {}, noBridge)).toBe(0)
  pool.release()
  await Bun.sleep(0)
  expect(second.unusable).toBe(true)
})
