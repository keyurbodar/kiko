import { mkdir, stat } from "node:fs/promises"
import { join } from "node:path"

type Target = { name: string; bun: Bun.Build.CompileTarget }

const TARGETS: Target[] = [
  { name: "linux-x64", bun: "bun-linux-x64" },
  { name: "linux-arm64", bun: "bun-linux-arm64" },
  { name: "darwin-x64", bun: "bun-darwin-x64" },
  { name: "darwin-arm64", bun: "bun-darwin-arm64" },
  { name: "windows-x64", bun: "bun-windows-x64" },
]

const app = join(import.meta.dir, "..")
const entry = join(app, "src", "index.ts")
const outdir = join(app, "dist")

async function compile(target: Target): Promise<string> {
  const ext = target.name.startsWith("windows") ? ".exe" : ""
  const outfile = join(outdir, `kiko-computer-${target.name}${ext}`)
  const result = await Bun.build({ entrypoints: [entry], compile: { target: target.bun, outfile } })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error(`bun build failed for ${target.name}`)
  }
  return outfile
}

await mkdir(outdir, { recursive: true })
for (const target of TARGETS) {
  const outfile = await compile(target)
  const size = await stat(outfile).then((info) => info.size)
  console.log(`${target.name}: ${outfile} (${(size / 1024 / 1024).toFixed(1)} MiB)`)
}
