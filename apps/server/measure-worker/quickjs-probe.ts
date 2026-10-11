import { ScriptVM } from "@yuki/sandbox/vm"
// @ts-ignore wrangler imports .wasm as a compiled module
import wasm from "quickjs-wasi/quickjs.wasm"

export async function quickjsProbe(calls: number): Promise<{ calls: number; out: unknown }> {
  const vm = await ScriptVM.create(
    {
      manifest: { yuki: 1, name: "probe", version: "1.0.0", description: "probe", hooks: ["beforeTool"] },
      files: { "main.js": `export const hooks = { beforeTool: async (call) => call.name === "write" && String(call.arguments.path).startsWith("/prod/") ? { block: "no" } : undefined }` },
    },
    wasm,
  )
  let out: unknown
  for (let i = 0; i < calls; i++) out = await vm.invoke({ group: "hooks", name: "beforeTool" }, [{ name: "write", arguments: { path: `/x/${i}` } }], {}, () => undefined)
  vm.dispose()
  return { calls, out: out ?? null }
}
