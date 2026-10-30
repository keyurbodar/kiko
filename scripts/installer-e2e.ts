import { createHash } from "node:crypto"
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { connect } from "node:net"
import { join } from "node:path"
import { installPs1, installSh } from "../apps/server/src/computer/install-route"
import { COMPUTER_APPS, computerSums } from "../core/computer/src/install"

const VERSION = "0.0.0-e2e"
const STATUS_TIMEOUT_MS = 10_000

async function publish(assets: string, site: string, base: string): Promise<void> {
  await mkdir(site, { recursive: true })
  const present: { name: string; sha256: string }[] = []
  for (const name of COMPUTER_APPS) {
    const bytes = await readFile(join(assets, name)).catch(() => null)
    if (!bytes) continue
    present.push({ name, sha256: createHash("sha256").update(bytes).digest("hex") })
    await copyFile(join(assets, name), join(site, name))
  }
  if (present.length === 0) throw new Error(`no kiko app archives in ${assets}`)
  const release = { version: VERSION, base, sums: computerSums(present) }
  await writeFile(join(site, "install.sh"), installSh(base, release))
  await writeFile(join(site, "install.ps1"), installPs1(base, release))
}

function serve(site: string, port: number): void {
  Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/pc/pair") return Response.json({ id: "pc-e2e", name: "e2e", userId: "user-e2e" })
      const file = Bun.file(join(site, url.pathname.slice(1)))
      return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 })
    },
  })
  console.log(`serving ${site} on http://127.0.0.1:${port}`)
}

function status(path: string): Promise<{ ok: boolean; value?: unknown; error?: unknown }> {
  return new Promise((resolve, reject) => {
    const socket = connect(path)
    let buffer = ""
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`the driver socket at ${path} did not answer`))
    }, STATUS_TIMEOUT_MS)
    socket.setEncoding("utf8")
    socket.on("connect", () => socket.write(`${JSON.stringify({ id: 1, method: "status" })}\n`))
    socket.on("data", (chunk: string) => {
      buffer += chunk
      const line = buffer.split("\n")[0]
      if (line === undefined) return
      clearTimeout(timer)
      socket.end()
      resolve(JSON.parse(line) as { ok: boolean })
    })
    socket.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

async function main(argv: string[]): Promise<number> {
  const [mode, ...rest] = argv
  if (mode === "serve") {
    const [assets, site, port] = rest
    if (!assets || !site || !port) throw new Error("usage: serve <assets> <site> <port>")
    await publish(assets, site, `http://127.0.0.1:${port}`)
    serve(site, Number(port))
    return 0
  }
  if (mode === "status") {
    const path = rest[0]
    if (!path) throw new Error("usage: status <socket>")
    const answer = await status(path)
    console.log(JSON.stringify(answer))
    return answer.ok ? 0 : 1
  }
  throw new Error("usage: installer-e2e.ts serve <assets> <site> <port> | status <socket>")
}

process.exitCode = await main(process.argv.slice(2))
