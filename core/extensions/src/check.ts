import { checkBundle, describeManifest, type ExtensionBundle, type ExtensionTest } from "./manifest"
import { triggerGapProblems } from "./triggers"
import type { Effect } from "@kiko/agent/effects"
import { type Bridge, ScriptError, ScriptVM } from "./vm"
import { type CallPort, makeQuietBridge, makeToolBridge, mayCall, type ScriptPorts } from "./compile"

export type CheckReport = { ok: boolean; lines: string[] }

export async function checkExtension(input: unknown, wasm: WebAssembly.Module, tools: ReadonlyMap<string, Effect>): Promise<CheckReport> {
  const checked = checkBundle(input)
  if (!checked.ok) return { ok: false, lines: checked.problems.map((p) => `problem: ${p}`) }
  const bundle: ExtensionBundle = checked.bundle
  const m = bundle.manifest
  const lines: string[] = []
  const problems: string[] = triggerGapProblems(bundle)

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
          const out = await vm.invoke({ group: "sections", name: id }, [], { extension: m.name, section: id }, quietBridge(bundle))
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

// The same bridge code the agent runs, over ports that answer from the manifest's tests instead of the network and the user's store.
function fakePorts(test: ExtensionTest): Pick<ScriptPorts, "state" | "fetch"> {
  const kept = new Map<string, unknown>()
  return {
    state: async (_name, _scope, op, key, value) => {
      if (op === "get") return kept.get(key) ?? null
      if (op === "set") return void kept.set(key, value ?? null)
      if (op === "delete") return void kept.delete(key)
      return [...kept.keys()].filter((k) => k.startsWith(key)).sort()
    },
    fetch: async () => {
      const body = test.fetch?.body ?? ""
      return { status: test.fetch?.status ?? 200, headers: {}, text: typeof body === "string" ? body : JSON.stringify(body), ...(typeof body === "string" ? {} : { json: body }) }
    },
  }
}

const quietBridge = (bundle: ExtensionBundle): Bridge => makeQuietBridge({ name: bundle.manifest.name, manifest: bundle.manifest, ports: fakePorts({} as ExtensionTest) }, "section", true)

function toolBridge(tools: ReadonlyMap<string, Effect>, effect: Effect, bundle: ExtensionBundle, test: ExtensionTest, tool: string, logs: string[]): Bridge {
  const calls: CallPort = {
    effectOf: async (name) => tools.get(name),
    run: async (name) => {
      if (!test.calls || !(name in test.calls)) throw new Error(`the test has no mock for ${name}; add it under "calls"`)
      const out = test.calls[name]
      return typeof out === "string" ? out : JSON.stringify(out)
    },
  }
  return makeToolBridge({ name: bundle.manifest.name, manifest: bundle.manifest, ports: fakePorts(test), effect, self: tool, logs, calls })
}

async function runTest(vm: ScriptVM, bundle: ExtensionBundle, test: ExtensionTest, n: number, tools: ReadonlyMap<string, Effect>): Promise<string> {
  const t = bundle.manifest.tools?.[test.tool]
  if (!t) return `fail test ${n}: no tool ${test.tool}`
  const logs: string[] = []
  try {
    const out = await vm.invoke({ group: "tools", name: test.tool }, [test.args ?? {}], { extension: bundle.manifest.name, tool: test.tool, callId: `test-${n}` }, toolBridge(tools, t.effect as Effect, bundle, test, test.tool, logs))
    const text = out === undefined || out === null ? "(no output)" : typeof out === "string" ? out : JSON.stringify(out)
    const shown = JSON.stringify(text.length > 200 ? `${text.slice(0, 200)}…` : text)
    if (test.expect !== undefined && !text.includes(test.expect)) return `fail test ${n} (${test.tool}): expected ${JSON.stringify(test.expect)} in ${shown}`
    return `pass test ${n} (${test.tool}): ${shown}${logs.length ? ` logs: ${logs.join(" | ").slice(0, 200)}` : ""}`
  } catch (e) {
    return `fail test ${n} (${test.tool}): ${e instanceof ScriptError || e instanceof Error ? e.message : String(e)}`
  }
}
