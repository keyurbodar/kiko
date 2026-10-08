import { EvalFlags, JSException, type JSValueHandle, QuickJS } from "quickjs-wasi"
import type { ExtensionBundle } from "./manifest"

// Architecture section 24.3. One QuickJS VM runs one extension's script inside the agent's object.
// QuickJS is compiled to wasm and imported with the Worker, so no code is evaluated by V8: the
// script is data for a bundled interpreter. The VM has no I/O of its own. Everything it can do
// outside its own memory goes through `__host`, and the host side decides per call.
//
// Data crosses as JSON text only, so a guest object never becomes a host object.
//
// Limits:
// - CPU: the interrupt handler counts. The Workers clock does not move during computation, so a
//   time check would never fire. QuickJS calls the handler about once per 5,000 loop iterations;
//   `SLICE_BUDGET` calls is about 100 ms of CPU, per entry into the VM.
// - Memory: `MEMORY_LIMIT`. A guest that runs out gets `InternalError: out of memory`, and the VM
//   is thrown away after the call.
// - Wall time: an invocation that has not settled in `WALL_MS` (a promise that never resolves)
//   fails.

export const SLICE_BUDGET = 300
export const MEMORY_LIMIT = 16 * 1024 * 1024
export const WALL_MS = 30_000
/**
 * Wasm linear memory never shrinks, and an isolate's 128 MB is shared by every object in it. A VM
 * starts at about 1.3 MB; one that has grown past this is retired after its call and the next call
 * gets a fresh one.
 */
export const RETIRE_BYTES = 8 * 1024 * 1024

/** What a script calls through `kiko`. The host builds one per invocation and decides what each may do. */
export type Bridge = (op: string, payload: unknown[]) => Promise<unknown> | unknown

/** What `invoke` runs: `tools.x`, `sections.x`, `hooks.x`, `wraps.tools.x`, or `wraps.sections.x`. */
export type Target = { group: "tools" | "sections" | "hooks" | "wrapTools" | "wrapSections"; name: string }

export type ExportShape = { tools: string[]; sections: string[]; hooks: string[]; wrapTools: string[]; wrapSections: string[] }

export class ScriptError extends Error {}

/** The guest half of the bridge. It runs before the extension's module, in the same realm. */
const PRELUDE = `
const host = globalThis.__host;
const hostSync = globalThis.__hostSync;
delete globalThis.__host;
delete globalThis.__hostSync;
const parse = (s) => (s === undefined ? undefined : JSON.parse(s));
const ask = (inv, op, args) => host(inv, op, JSON.stringify(args)).then(parse);
const makeKiko = (inv, env) => Object.freeze({
  env: Object.freeze(env),
  callId: env.callId,
  call: (tool, args) => ask(inv, "call", [String(tool), args ?? {}]),
  fetch: (url, init) => ask(inv, "fetch", [String(url), init ?? {}]),
  next: (args) => ask(inv, "next", [args ?? {}]),
  state: Object.freeze({
    get: (key) => ask(inv, "state.get", [String(key)]),
    set: (key, value) => ask(inv, "state.set", [String(key), value === undefined ? null : value]),
    delete: (key) => ask(inv, "state.delete", [String(key)]),
    list: (prefix) => ask(inv, "state.list", [prefix === undefined ? "" : String(prefix)]),
  }),
  log: (...parts) => { hostSync(inv, "log", JSON.stringify([parts.map((p) => typeof p === "string" ? p : JSON.stringify(p))])); },
  now: () => Date.now(),
});
const pick = (mod, group, name) => {
  if (group === "wrapTools") return mod.wraps && mod.wraps.tools && mod.wraps.tools[name];
  if (group === "wrapSections") return mod.wraps && mod.wraps.sections && mod.wraps.sections[name];
  return mod[group] && mod[group][name];
};
globalThis.__invoke = async (mod, inv, group, name, argsText, envText) => {
  const fn = pick(mod, group, name);
  if (typeof fn !== "function") throw new Error(group + " " + name + " is not a function the script exports");
  const out = await fn(...JSON.parse(argsText), makeKiko(inv, JSON.parse(envText)));
  return out === undefined ? undefined : JSON.stringify(out);
};
globalThis.__shape = (mod) => {
  const keys = (o) => (o && typeof o === "object" ? Object.keys(o).filter((k) => typeof o[k] === "function") : []);
  return JSON.stringify({
    tools: keys(mod.tools), sections: keys(mod.sections), hooks: keys(mod.hooks),
    wrapTools: keys(mod.wraps && mod.wraps.tools), wrapSections: keys(mod.wraps && mod.wraps.sections),
  });
};
`

/** Resolves `./x.js` and `../x.js` against the importing module, inside the bundle. */
function resolve(base: string, specifier: string): string {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return specifier
  const parts = base.split("/").slice(0, -1)
  for (const p of specifier.split("/")) {
    if (p === "..") parts.pop()
    else if (p !== ".") parts.push(p)
  }
  return parts.join("/")
}

/** A guest exception as one line the model and the human can read. */
function describe(e: unknown): string {
  if (e instanceof JSException) {
    const msg = e.name && e.name !== "Error" ? `${e.name}: ${e.message}` : e.message || e.name
    e.dispose()
    if (/interrupted/i.test(msg)) return "the script ran too long and was stopped"
    return msg
  }
  if (e instanceof ScriptError) return e.message
  return e instanceof Error ? e.message : String(e)
}

const errorText = (vm: QuickJS, h: JSValueHandle): string => {
  const v = vm.dump(h) as { name?: string; message?: string } | string | undefined
  h.dispose()
  if (v && typeof v === "object") {
    const msg = `${v.name && v.name !== "Error" ? `${v.name}: ` : ""}${v.message ?? ""}`
    return /interrupted/i.test(msg) ? "the script ran too long and was stopped" : msg || "the script failed"
  }
  return String(v ?? "the script failed")
}

export class ScriptVM {
  private steps = 0
  private broken = false
  private readonly bridges = new Map<string, Bridge>()
  private invocations = 0
  private disposed = false

  private constructor(
    private readonly vm: QuickJS,
    private readonly mod: JSValueHandle,
    private readonly invoke$: JSValueHandle,
    readonly shape: ExportShape,
  ) {}

  /** Starts a VM and evaluates the bundle's entry module. Throws `ScriptError` with the guest's error. */
  static async create(bundle: ExtensionBundle, wasm: WebAssembly.Module | BufferSource): Promise<ScriptVM> {
    const main = bundle.manifest.main ?? "main.js"
    let steps = 0
    const holder: { vm?: ScriptVM } = {}
    const vm = await QuickJS.create({
      wasm,
      memoryLimit: MEMORY_LIMIT,
      interruptHandler: () => {
        if (holder.vm) return ++holder.vm.steps > SLICE_BUDGET
        return ++steps > SLICE_BUDGET
      },
      moduleLoader: {
        normalize: (base, specifier) => resolve(base, specifier),
        load: (name) => {
          const src = bundle.files[name]
          if (typeof src !== "string") throw new Error(`module "${name}" is not in the extension`)
          return src
        },
      },
    })
    try {
      const host = vm.newFunction("__host", (invHandle, opHandle, payloadHandle) => {
        // Handles live only for this synchronous call: read every argument now, before any await.
        const inv = invHandle!.toString()
        const op = opHandle!.toString()
        const payload = payloadHandle!.toString()
        const bridge = holder.vm?.bridges.get(inv)
        const deferred = vm.newPromise()
        const settle = (fn: () => void) => {
          if (!holder.vm || holder.vm.broken) return
          fn()
          holder.vm.enter(() => vm.executePendingJobs())
        }
        if (!bridge) {
          deferred.reject(vm.newError("this call has ended; kiko is only usable while the function that received it runs"))
          return deferred.handle
        }
        let args: unknown[]
        try {
          args = JSON.parse(payload) as unknown[]
        } catch {
          deferred.reject(vm.newError("arguments must be json"))
          return deferred.handle
        }
        Promise.resolve()
          .then(() => bridge(op, args))
          .then(
            (value) => settle(() => deferred.resolve(value === undefined ? vm.undefined : vm.newString(JSON.stringify(value)))),
            (error) => settle(() => deferred.reject(vm.newError(error instanceof Error ? error.message : String(error)))),
          )
        return deferred.handle
      })
      vm.setProp(vm.global, "__host", host)
      host.dispose()
      const hostSync = vm.newFunction("__hostSync", (inv, op, payload) => {
        const bridge = holder.vm?.bridges.get(inv!.toString())
        if (bridge) {
          try {
            void bridge(op!.toString(), JSON.parse(payload!.toString()) as unknown[])
          } catch {
            // A log line that fails is dropped.
          }
        }
        return vm.undefined
      })
      vm.setProp(vm.global, "__hostSync", hostSync)
      hostSync.dispose()
      vm.evalCode(PRELUDE, "kiko:prelude").dispose()
      steps = 0
      const promise = vm.evalCode(bundle.files[main] ?? "", main, EvalFlags.TYPE_MODULE)
      vm.executePendingJobs()
      const settled = await vm.resolvePromise(promise)
      promise.dispose()
      if ("error" in settled) throw new ScriptError(errorText(vm, settled.error))
      const mod = settled.value
      const invoke = vm.global.getProp("__invoke")
      const shapeFn = vm.global.getProp("__shape")
      const shapeText = vm.callFunction(shapeFn, vm.undefined, mod).consume((h) => h.toString())
      shapeFn.dispose()
      const script = new ScriptVM(vm, mod, invoke, JSON.parse(shapeText) as ExportShape)
      holder.vm = script
      return script
    } catch (e) {
      vm.dispose()
      throw new ScriptError(describe(e))
    }
  }

  /** Runs guest code with a fresh CPU slice. */
  private enter<T>(fn: () => T): T {
    this.steps = 0
    return fn()
  }

  /** True after an out-of-memory or another failure that leaves the VM unsafe to reuse, or once retired. */
  get unusable(): boolean {
    return this.broken
  }

  /** The VM's wasm linear memory, in bytes. */
  get memoryBytes(): number {
    try {
      return (this.vm as unknown as { _getMemory(): WebAssembly.Memory })._getMemory().buffer.byteLength
    } catch {
      return 0
    }
  }

  /**
   * Calls one exported function with JSON arguments and the invocation's `kiko` environment. The
   * result is the function's return value as JSON, or undefined. Throws `ScriptError` with the
   * guest's error as one line.
   */
  async invoke(target: Target, args: unknown[], env: Record<string, unknown>, bridge: Bridge): Promise<unknown> {
    if (this.broken) throw new ScriptError("the script stopped working; it restarts on the next call")
    const inv = `inv-${++this.invocations}-${crypto.randomUUID()}`
    this.bridges.set(inv, bridge)
    const vm = this.vm
    const handles = [vm.newString(inv), vm.newString(target.group), vm.newString(target.name), vm.newString(JSON.stringify(args)), vm.newString(JSON.stringify(env))]
    let promise: JSValueHandle | undefined
    try {
      promise = this.enter(() => vm.callFunction(this.invoke$, vm.undefined, this.mod, ...handles))
      this.enter(() => vm.executePendingJobs())
      const settled = await Promise.race([
        vm.resolvePromise(promise),
        new Promise<never>((_, reject) => AbortSignal.timeout(WALL_MS).addEventListener("abort", () => reject(new ScriptError(`the script did not finish in ${WALL_MS / 1000} seconds`)))),
      ])
      if ("error" in settled) {
        const text = errorText(vm, settled.error)
        if (/out of memory/i.test(text)) this.broken = true
        throw new ScriptError(text)
      }
      const out = settled.value.consume((h) => (vm.typeof(h) === "string" ? h.toString() : undefined))
      return out === undefined ? undefined : JSON.parse(out)
    } catch (e) {
      const text = describe(e)
      if (/out of memory/i.test(text)) this.broken = true
      throw new ScriptError(text)
    } finally {
      this.bridges.delete(inv)
      for (const h of handles) h.dispose()
      promise?.dispose()
      // A VM that grew too big takes no new calls, and frees its memory once the last call ends.
      if (this.memoryBytes > RETIRE_BYTES) this.broken = true
      if (this.broken && this.bridges.size === 0) this.dispose()
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.broken = true
    this.bridges.clear()
    try {
      this.mod.dispose()
      this.invoke$.dispose()
      this.vm.dispose()
    } catch {
      // Already gone.
    }
  }
}
