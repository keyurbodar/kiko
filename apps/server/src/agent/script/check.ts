import { checkBundle, describeManifest, type ExtensionBundle, type ExtensionTest } from "@kiko/protocol"
import type { Effect } from "@kiko/agent/effects"
import { isPlainGet, mayCall } from "./compile"
import { ScriptError, ScriptVM } from "./vm"

// Architecture section 24.6. What `extension_check` runs before an agent proposes an extension:
// the manifest, the load, the exports against the manifest, and the manifest's own tests with every
// call and fetch answered by mocks. Nothing leaves the VM, so a check is free and safe to repeat.

export type CheckReport = { ok: boolean; lines: string[] }

/**
 * `tools` maps the agent's tool names to their effects, so a `calls` entry that names a missing or
 * stronger tool fails here instead of at run time.
 */
export async function checkExtension(input: unknown, wasm: WebAssembly.Module, tools: ReadonlyMap<string, Effect>): Promise<CheckReport> {
  const checked = checkBundle(input)
  if (!checked.ok) return { ok: false, lines: checked.problems.map((p) => `problem: ${p}`) }
  const bundle: ExtensionBundle = checked.bundle
  const m = bundle.manifest
  const lines: string[] = []
  const problems: string[] = []

  for (const name of Object.keys(m.tools ?? {})) if (tools.has(name)) problems.push(`tool ${name} is a built-in tool; pick another name`)
  for (const c of m.calls ?? []) {
    const effect = tools.get(c)
    if (!effect) problems.push(`calls: this agent has no tool ${c}`)
    else {
      const callers = Object.entries(m.tools ?? {}).filter(([, t]) => mayCall(t.effect as Effect, effect))
      if (!callers.length) problems.push(`calls: ${c} is "${effect}" and no tool of this extension may call it; raise a tool's effect`)
    }
  }

  const needsVm = Object.keys(m.tools ?? {}).length || Object.values(m.sections ?? {}).some((s) => s.text === undefined) || m.hooks?.length || m.wraps?.tools?.length || m.wraps?.sections?.length
  if (needsVm) {
    let vm: ScriptVM
    try {
      vm = await ScriptVM.create(bundle, wasm)
    } catch (e) {
      return { ok: false, lines: [...problems.map((p) => `problem: ${p}`), `problem: the script does not load: ${e instanceof Error ? e.message : String(e)}`] }
    }
    try {
      const want = (group: string, names: string[], have: string[]) => {
        for (const n of names) if (!have.includes(n)) problems.push(`the script does not export ${group}.${n}`)
        for (const n of have) if (!names.includes(n)) lines.push(`note: ${group}.${n} is exported but not in extension.json, so it is never used`)
      }
      want("tools", Object.keys(m.tools ?? {}), vm.shape.tools)
      want("sections", Object.entries(m.sections ?? {}).filter(([, s]) => s.text === undefined).map(([id]) => id), vm.shape.sections)
      want("hooks", [...(m.hooks ?? [])], vm.shape.hooks)
      want("wraps.tools", [...(m.wraps?.tools ?? [])], vm.shape.wrapTools)
      want("wraps.sections", [...(m.wraps?.sections ?? [])], vm.shape.wrapSections)
      for (const [i, test] of (m.tests ?? []).entries()) lines.push(await runTest(vm, bundle, test, i + 1, tools))
      for (const id of vm.shape.sections.filter((s) => m.sections?.[s]?.text === undefined && m.sections?.[s])) {
        try {
          const out = await vm.invoke({ group: "sections", name: id }, [], { extension: m.name, section: id }, mockBridge({ tools, effect: "read", bundle, test: {} as ExtensionTest, logs: [] }))
          lines.push(`section ${id} renders: ${typeof out === "string" ? JSON.stringify(out.slice(0, 160)) : "nothing"}`)
        } catch (e) {
          problems.push(`section ${id} throws: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    } finally {
      vm.dispose()
    }
  }

  const failed = lines.filter((l) => l.startsWith("fail")).length
  const review = describeManifest(m).map((l) => `power: ${l.text}`)
  const ok = problems.length === 0 && failed === 0
  return {
    ok,
    lines: [
      ok ? `ok: ${m.name} ${m.version} is ready to propose` : `not ready: ${problems.length + failed} problem${problems.length + failed === 1 ? "" : "s"}`,
      ...problems.map((p) => `problem: ${p}`),
      ...lines,
      ...review,
    ],
  }
}

type MockInput = { tools: ReadonlyMap<string, Effect>; effect: Effect; bundle: ExtensionBundle; test: ExtensionTest; logs: string[] }

/** The same rules as the live bridge, with the test's mocks in place of tools, fetches, and state. */
function mockBridge({ tools, effect, bundle, test, logs }: MockInput, state = new Map<string, unknown>()) {
  const m = bundle.manifest
  return async (op: string, payload: unknown[]): Promise<unknown> => {
    if (op === "log") {
      logs.push(((payload[0] as string[]) ?? []).join(" "))
      return undefined
    }
    if (op.startsWith("state.")) {
      if (!m.state) throw new Error(`kiko.state needs "state" in extension.json`)
      const key = String(payload[0] ?? "")
      if (op === "state.get") return state.get(key) ?? null
      if (op === "state.set") return void state.set(key, payload[1] ?? null)
      if (op === "state.delete") return void state.delete(key)
      if (op === "state.list") return [...state.keys()].filter((k) => k.startsWith(key)).sort()
    }
    if (op === "fetch") {
      if (effect !== "external" && !isPlainGet(payload[1] as never)) throw new Error(`only a GET without a body works in a "${effect}" tool; it needs "external" to send anything`)
      const url = new URL(String(payload[0]))
      const egress = m.egress ?? []
      const allowed = egress.some((p) => (p.startsWith("*.") ? url.hostname.endsWith(p.slice(1)) : url.hostname === p))
      if (!allowed) throw new Error(`${url.hostname} is not in "egress" in extension.json`)
      const body = test.fetch?.body ?? ""
      const text = typeof body === "string" ? body : JSON.stringify(body)
      return { status: test.fetch?.status ?? 200, headers: {}, text, ...(typeof body === "string" ? {} : { json: body }) }
    }
    if (op === "call") {
      const tool = String(payload[0])
      if (!(m.calls ?? []).includes(tool)) throw new Error(`${tool} is not in "calls" in extension.json`)
      const callee = tools.get(tool)
      if (!callee) throw new Error(`this agent has no tool ${tool}`)
      if (!mayCall(effect, callee)) throw new Error(`a "${effect}" tool cannot call ${tool}, which is "${callee}"`)
      if (!test.calls || !(tool in test.calls)) throw new Error(`the test has no mock for ${tool}; add it under "calls"`)
      const out = test.calls[tool]
      return typeof out === "string" ? out : JSON.stringify(out)
    }
    throw new Error(`kiko.${op} is not available here`)
  }
}

async function runTest(vm: ScriptVM, bundle: ExtensionBundle, test: ExtensionTest, n: number, tools: ReadonlyMap<string, Effect>): Promise<string> {
  const t = bundle.manifest.tools?.[test.tool]
  if (!t) return `fail test ${n}: no tool ${test.tool}`
  const logs: string[] = []
  try {
    const out = await vm.invoke({ group: "tools", name: test.tool }, [test.args ?? {}], { extension: bundle.manifest.name, tool: test.tool, callId: `test-${n}` }, mockBridge({ tools, effect: t.effect as Effect, bundle, test, logs }))
    const text = out === undefined || out === null ? "(no output)" : typeof out === "string" ? out : JSON.stringify(out)
    const shown = JSON.stringify(text.length > 200 ? `${text.slice(0, 200)}…` : text)
    if (test.expect !== undefined && !text.includes(test.expect)) return `fail test ${n} (${test.tool}): expected ${JSON.stringify(test.expect)} in ${shown}`
    return `pass test ${n} (${test.tool}): ${shown}${logs.length ? ` logs: ${logs.join(" | ").slice(0, 200)}` : ""}`
  } catch (e) {
    return `fail test ${n} (${test.tool}): ${e instanceof ScriptError || e instanceof Error ? e.message : String(e)}`
  }
}
