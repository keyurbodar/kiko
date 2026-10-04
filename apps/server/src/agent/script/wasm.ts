import { ScriptError } from "./vm"

// The QuickJS binary, compiled once per isolate by the runtime. Only the Worker entry imports the
// `.wasm` file (`index.ts`), because a test bundle of one Durable Object has no wasm loader. Without
// it, extensions fail with a plain error and the agent runs without them.

let compiled: WebAssembly.Module | undefined

export function setScriptWasm(module: WebAssembly.Module): void {
  compiled = module
}

export function scriptWasm(): WebAssembly.Module {
  if (!compiled) throw new ScriptError("extensions are not available in this build")
  return compiled
}

export const hasScriptWasm = () => compiled !== undefined
