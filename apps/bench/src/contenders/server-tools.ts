import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import type { ToolSpec } from "../types"

const SERVER_TOOLS = fileURLToPath(new URL("../../../server/src/agent/computer/tools.ts", import.meta.url))

const SCRIPT = [
  `const { computerExtension, computerInfoExtension } = await import(${JSON.stringify(SERVER_TOOLS)})`,
  `const desktop = JSON.parse(process.env.BENCH_DESKTOP_TOOLS ?? "[]")`,
  `const deps = { port: () => { throw new Error("no port") }, acceptsImages: () => true, desktop }`,
  `const skip = new Set(["computer_link"])`,
  `const tools = [...computerExtension(deps).tools, ...computerInfoExtension(deps).tools]`,
  `  .filter((tool) => !skip.has(tool.name))`,
  `  .map(({ name, description, parameters }) => ({ name, description, parameters }))`,
  `console.log(JSON.stringify(tools))`,
].join("\n")

export function serverToolSpecs(desktop: readonly unknown[] = []): ToolSpec[] {
  const out = execFileSync("bun", ["-e", SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, BENCH_DESKTOP_TOOLS: JSON.stringify(desktop) },
  })
  return JSON.parse(out) as ToolSpec[]
}
