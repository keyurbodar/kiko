import { mkdir, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"

const DATACHANNEL_VERSION = "0.33.4"
const ADDON_TIMEOUT_MS = 300_000

type Target = { name: string; bun: Bun.Build.CompileTarget; addon: string }

const TARGETS: Target[] = [
  { name: "linux-x64", bun: "bun-linux-x64", addon: "linux-x64-gnu" },
  { name: "linux-arm64", bun: "bun-linux-arm64", addon: "linux-arm64-gnu" },
  { name: "darwin-x64", bun: "bun-darwin-x64", addon: "darwin-x64" },
  { name: "darwin-arm64", bun: "bun-darwin-arm64", addon: "darwin-arm64" },
  { name: "windows-x64", bun: "bun-windows-x64", addon: "win32-x64-msvc" },
]

const app = join(import.meta.dir, "..")
const entry = join(app, "src", "index.ts")
const outdir = join(app, "dist")
const addons = join(app, "dist", "addons")
const { version } = (await Bun.file(join(app, "..", "..", "package.json")).json()) as { version: string }

async function addonFor(target: Target): Promise<string> {
  const dir = join(addons, target.addon)
  const file = join(dir, "package", "node_datachannel.node")
  if (existsSync(file)) return file
  await mkdir(dir, { recursive: true })
  const url = `https://registry.npmjs.org/@node-datachannel/${target.addon}/-/${target.addon}-${DATACHANNEL_VERSION}.tgz`
  const response = await fetch(url, { signal: AbortSignal.timeout(ADDON_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  const tarball = join(dir, "addon.tgz")
  await Bun.write(tarball, response)
  const untar = Bun.spawnSync(["tar", "xzf", tarball, "-C", dir])
  if (untar.exitCode !== 0 || !existsSync(file)) throw new Error(`could not unpack ${url}`)
  return file
}

function embedAddon(file: string): Bun.BunPlugin {
  return {
    name: "embed-node-datachannel",
    setup(build) {
      build.onLoad({ filter: /node-datachannel[\\/]dist[\\/]esm[\\/]lib[\\/]node-datachannel\.mjs$/ }, () => ({
        loader: "js",
        contents: `import addon from ${JSON.stringify(file)}\nexport default addon\n`,
      }))
    },
  }
}

async function compile(target: Target): Promise<string> {
  const ext = target.name.startsWith("windows") ? ".exe" : ""
  const outfile = join(outdir, `kiko-computer-${target.name}${ext}`)
  const result = await Bun.build({
    entrypoints: [entry],
    compile: { target: target.bun, outfile },
    define: { "process.env.KIKO_COMPUTER_VERSION": JSON.stringify(version) },
    plugins: [embedAddon(await addonFor(target))],
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error(`bun build failed for ${target.name}`)
  }
  return outfile
}

const only = process.argv.slice(2)
await mkdir(outdir, { recursive: true })
await Promise.all(
  TARGETS.filter((t) => only.length === 0 || only.includes(t.name)).map(async (target) => {
    const outfile = await compile(target)
    const size = await stat(outfile).then((info) => info.size)
    console.log(`${target.name} ${version}: ${outfile} (${(size / 1024 / 1024).toFixed(1)} MiB)`)
  }),
)
