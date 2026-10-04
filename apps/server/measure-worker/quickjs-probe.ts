import { ScriptVM } from "../src/agent/script/vm"
// @ts-ignore wrangler imports .wasm as a compiled module
import wasm from "quickjs-wasi/quickjs.wasm"

// Experiment 4 for extensions (architecture section 24.1): a cold VM start plus `calls` hook
// invocations, inside one Durable Object request, so `wrangler tail` shows what it costs on this plan.
export async function quickjsProbe(calls: number): Promise<{ calls: number; out: unknown }> {
  const vm = await ScriptVM.create(
    {
      manifest: { kiko: 1, name: "probe", version: "1.0.0", description: "probe", hooks: ["beforeTool"] },
      files: { "main.js": `export const hooks = { beforeTool: async (call) => call.name === "write" && String(call.arguments.path).startsWith("/prod/") ? { block: "no" } : undefined }` },
    },
    wasm,
  )
  let out: unknown
  for (let i = 0; i < calls; i++) out = await vm.invoke({ group: "hooks", name: "beforeTool" }, [{ name: "write", arguments: { path: `/x/${i}` } }], {}, () => undefined)
  vm.dispose()
  return { calls, out: out ?? null }
}
