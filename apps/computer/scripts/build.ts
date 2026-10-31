import { mkdir, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"

const DATACHANNEL_VERSION = "0.33.4"

type Target = { name: string; bun: Bun.Build.CompileTarget; addon: string; integrity: string }

const TARGETS: Target[] = [
  {
    name: "linux-x64",
    bun: "bun-linux-x64",
    addon: "linux-x64-gnu",
    integrity: "sha512-xN0x3lcQ87qwOAmf1dBLVWrYY40LQ7pM4Y9wuNjP+EtN4IwiXqrhPdgupzGAElxna+n2NgBG0gT60dZpgoYU2Q==",
  },
  {
    name: "linux-arm64",
    bun: "bun-linux-arm64",
    addon: "linux-arm64-gnu",
    integrity: "sha512-rR4yjwxpI1miLSrruLGcfR9yfw0Qebw+Twt+u+lKsL9SwmXxTm5pJhUAa9RU+c35oZ98IyAxGFjRwwq85BTbog==",
  },
  {
    name: "darwin-x64",
    bun: "bun-darwin-x64",
    addon: "darwin-x64",
    integrity: "sha512-+dLnwiwC3GdWqW0OQShZcSFYrx3hRx0+7U85swoiP3iiRqtDUARME6AIAmW3glpP0vmus1jv5KhPCy/Q+jAvqw==",
  },
  {
    name: "darwin-arm64",
    bun: "bun-darwin-arm64",
    addon: "darwin-arm64",
    integrity: "sha512-bkIA+IbModz/NUmbVYTSWj8dZvkiab+cU4zOa6rhfKsNcW3EkdD2/DDoJjUrRrw+LbEZ40V7NuAKUlMNFDXFsw==",
  },
  {
    name: "windows-x64",
    bun: "bun-windows-x64",
    addon: "win32-x64-msvc",
    integrity: "sha512-eU0w/9ykrNaA5vWs5gjVs3Qxa45jbQ8mYoMyh5OWnRCE5GzXKxHCpfhFUnO+jGqi0KxkyP0hSA6fiwXXkirk6g==",
  },
]

const app = join(import.meta.dir, "..")
const entry = join(app, "src", "index.ts")
const outdir = join(app, "dist")
const addons = join(app, "dist", "addons")
const { version } = (await Bun.file(join(app, "..", "..", "package.json")).json()) as { version: string }

async function addonFor(target: Target): Promise<string> {
  const dir = join(addons, `${target.addon}-${DATACHANNEL_VERSION}`)
  const file = join(dir, "package", "node_datachannel.node")
  const tarball = join(dir, "addon.tgz")
  const url = `https://registry.npmjs.org/@node-datachannel/${target.addon}/-/${target.addon}-${DATACHANNEL_VERSION}.tgz`
  const cached = await cachedBytes(tarball, target.integrity)
  if (cached && existsSync(file)) return file
  await mkdir(dir, { recursive: true })
  await Bun.write(tarball, cached ?? (await download(url, target.integrity)))
  const untar = Bun.spawnSync(["tar", "xzf", tarball, "-C", dir])
  if (untar.exitCode !== 0 || !existsSync(file)) throw new Error(`could not unpack ${url}`)
  return file
}

async function cachedBytes(file: string, integrity: string): Promise<Uint8Array | null> {
  if (!existsSync(file)) return null
  const bytes = new Uint8Array(await Bun.file(file).arrayBuffer())
  return digest(bytes) === integrity ? bytes : null
}

async function download(url: string, integrity: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const actual = digest(bytes)
  if (actual !== integrity) throw new Error(`${url} hashed to ${actual}, expected ${integrity}`)
  return bytes
}

function digest(bytes: Uint8Array): string {
  return `sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}`
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
