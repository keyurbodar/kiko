import { ScriptError } from "./vm"

let compiled: WebAssembly.Module | undefined

export function setScriptWasm(module: WebAssembly.Module): void {
  compiled = module
}

export function scriptWasm(): WebAssembly.Module {
  if (!compiled) throw new ScriptError("extensions are not available in this build")
  return compiled
}

export const hasScriptWasm = () => compiled !== undefined
