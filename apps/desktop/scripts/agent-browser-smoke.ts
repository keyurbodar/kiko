import { mkdtemp } from "node:fs/promises"
import { connect, type Socket } from "node:net"
import { join } from "node:path"
import { tmpdir } from "node:os"

const START_TIMEOUT_MS = 60_000
const CALL_TIMEOUT_MS = 180_000
const POLL_MS = 100

type Reply = { id?: number; ok?: boolean; value?: unknown; error?: { code?: string; message?: string } }
type Node = { ref: number; role: string; name?: string; value?: string; actions?: string[] }
type Page = {
  tab: Tab
  nodes: Node[]
  outline: string
  image?: { mime: string; data: string; width: number; height: number }
}
type Tab = { id: string; title: string; url: string; active: boolean }

class Driver {
  private buffer = ""
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

  private constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8")
    socket.on("data", (chunk: string) => this.receive(chunk))
    socket.on("close", () => this.failAll(new Error("the kiko driver socket closed")))
    socket.on("error", (error: Error) => this.failAll(error))
  }

  static connect(path: string): Promise<Driver> {
    return new Promise((resolve, reject) => {
      const socket = connect(path)
      socket.once("connect", () => {
        socket.removeListener("error", reject)
        resolve(new Driver(socket))
      })
      socket.once("error", reject)
    })
  }

  call(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++
    const line = JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, CALL_TIMEOUT_MS)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.socket.write(`${line}\n`)
    })
  }

  close(): void {
    this.socket.end()
  }

  private receive(chunk: string): void {
    this.buffer += chunk
    let index = this.buffer.indexOf("\n")
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (line) this.deliver(line)
      index = this.buffer.indexOf("\n")
    }
  }

  private deliver(line: string): void {
    let reply: Reply
    try {
      reply = JSON.parse(line) as Reply
    } catch {
      return
    }
    if (typeof reply.id !== "number") return
    const pending = this.pending.get(reply.id)
    if (!pending) return
    this.pending.delete(reply.id)
    if (reply.ok === true) pending.resolve(reply.value)
    else pending.reject(new Error(reply.error?.message ?? "the kiko driver failed the call"))
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

function socketPath(app: string): string {
  return join(app, "driver.sock")
}

async function connectDriver(path: string): Promise<Driver> {
  const deadline = Date.now() + START_TIMEOUT_MS
  for (;;) {
    try {
      return await Driver.connect(path)
    } catch (error) {
      if (Date.now() >= deadline)
        throw new Error(`the kiko driver socket ${path} never opened: ${String(error)}`, { cause: error })
    }
    await Bun.sleep(POLL_MS)
  }
}

async function command(args: string[]): Promise<string> {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "ignore" })
  const out = await new Response(proc.stdout).text()
  await proc.exited
  return out.trim()
}

async function macFrontmost(): Promise<string> {
  const front = await command(["lsappinfo", "front"])
  if (!front) throw new Error("lsappinfo does not name a front application")
  const info = await command(["lsappinfo", "info", "-only", "name", front])
  const match = info.match(/"LSDisplayName"="([^"]+)"/) ?? info.match(/"name"="([^"]+)"/)
  return match?.[1] ?? info.trim()
}

async function frontmost(): Promise<string> {
  if (process.platform === "darwin") return macFrontmost()
  return command(["xdotool", "getactivewindow", "getwindowname"])
}

async function linuxFocus(title: string): Promise<void> {
  const found = await command(["xdotool", "search", "--name", title])
  const id = found
    .split("\n")
    .map((line) => line.trim())
    .findLast(Boolean)
  if (id) await command(["xdotool", "windowactivate", "--sync", id])
}

async function focusDecoy(decoy: string): Promise<void> {
  try {
    if (process.platform === "darwin") await command(["open", "-a", decoy])
    else await linuxFocus(decoy)
  } catch {
    return
  }
}

type Fixture = { decoy: string; stop(): Promise<void> }

async function startFixture(): Promise<Fixture> {
  const script = join(import.meta.dir, "fixtures", "gtk_window.py")
  if (process.platform === "darwin") {
    Bun.spawn(["open", "-a", "Finder"], { stdout: "ignore", stderr: "ignore" })
    return { decoy: "Finder", stop: async () => {} }
  }
  const decoy = Bun.spawn(["python3", script, "kiko-engine-decoy", ""], { stdout: "ignore", stderr: "inherit" })
  return {
    decoy: "kiko-engine-decoy",
    stop: async () => {
      decoy.kill()
    },
  }
}

async function frontAwayFrom(fixture: Fixture): Promise<string> {
  const deadline = Date.now() + 10_000
  for (;;) {
    await focusDecoy(fixture.decoy)
    await Bun.sleep(200)
    const front = await frontmost()
    if (!front.includes("kiko browser fixture") || Date.now() >= deadline) return front
  }
}

function startKiko(kiko: string, browser: string, app: string) {
  return Bun.spawn([kiko], {
    env: {
      ...process.env,
      KIKO_APP_DIR: app,
      KIKO_COMPUTER_DIR: join(app, "computer"),
      KIKO_CORE: kiko,
      KIKO_CORE_STUB_LOG: join(app, "starts.log"),
      KIKO_AGENT_BROWSER: browser,
    },
    stdout: "ignore",
    stderr: "inherit",
  })
}

async function waitForBrowser(driver: Driver): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS
  for (;;) {
    const status = await driver.call("status")
    const browsers = isRecord(status) && Array.isArray(status.browsers) ? status.browsers : []
    const connected = browsers.some((browser) => isRecord(browser) && browser.state === "connected")
    if (connected) return
    if (Date.now() >= deadline) throw new Error(`the browser engine never answered: ${JSON.stringify(status)}`)
    await Bun.sleep(POLL_MS)
  }
}

function nodeNamed(page: Page, role: string, name: string): Node {
  const found = page.nodes.find((node) => node.role === role && node.name === name)
  if (!found) throw new Error(`no ${role} called ${name}: ${page.outline.slice(0, 600)}`)
  return found
}

function pageOf(value: unknown): Page {
  if (!isRecord(value) || !Array.isArray(value.nodes) || typeof value.outline !== "string")
    throw new Error(`the driver did not return a page: ${JSON.stringify(value).slice(0, 400)}`)
  return value as Page
}

async function main(): Promise<void> {
  const kiko = required("KIKO_BIN")
  const browser = required("KIKO_AGENT_BROWSER")
  const typed = process.env.KIKO_SMOKE_TYPED ?? "kiko browser typed this"
  const dir = await mkdtemp(join(tmpdir(), "kiko-agent-browser-smoke-"))
  const app = join(dir, "app")
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      if (path === "/") return new Response(Bun.file(join(import.meta.dir, "fixtures", "browser-page.html")))
      return new Response("not found", { status: 404 })
    },
  })
  const child = startKiko(kiko, browser, app)
  let driver: Driver | null = null
  let fixture: Fixture | null = null
  try {
    driver = await connectDriver(socketPath(app))
    await waitForBrowser(driver)

    fixture = await startFixture()
    const before = await frontAwayFrom(fixture)

    const opened = (await driver.call("browser.open", {
      url: `http://127.0.0.1:${server.port}/`,
      mode: "background",
    })) as Tab
    const first = pageOf(await driver.call("browser.read", { tab: opened.id, image: false }))
    const button = nodeNamed(first, "button", "Press me")
    const field = nodeNamed(first, "text field", "Name")

    await driver.call("browser.act", { tab: opened.id, ref: button.ref, action: "click", mode: "background" })
    const clicked = pageOf(await driver.call("browser.read", { tab: opened.id, image: false }))
    if (!clicked.outline.includes("clicked"))
      throw new Error(`the click did not change the page: ${clicked.outline.slice(0, 600)}`)

    await driver.call("browser.act", {
      tab: opened.id,
      ref: field.ref,
      action: "type",
      text: typed,
      mode: "background",
    })
    const afterType = pageOf(await driver.call("browser.read", { tab: opened.id, image: false }))
    const written = afterType.nodes.find((node) => node.role === "text field")
    if (written?.value !== typed)
      throw new Error(`the field does not hold ${typed}: ${JSON.stringify(written)} ${afterType.outline.slice(0, 400)}`)

    await driver.call("browser.show", { tab: opened.id })
    const framed = pageOf(await driver.call("browser.read", { tab: opened.id, image: true }))
    const image = framed.image
    if (!image || image.mime !== "image/jpeg" || image.data.length === 0)
      throw new Error(`browser.read returned no frame: ${JSON.stringify(image)}`)

    const after = await frontmost()
    if (before !== after) throw new Error(`the browser changed the front window: ${before} -> ${after}`)

    console.log(
      JSON.stringify({
        ok: true,
        tab: opened.id,
        title: opened.title,
        url: opened.url,
        read: first.outline.trim().split("\n").slice(0, 6),
        clicked: true,
        typed,
        show: true,
        frame: { mime: image.mime, width: image.width, height: image.height, bytes: image.data.length },
        frontBefore: before,
        frontAfter: after,
      }),
    )
  } finally {
    driver?.close()
    await fixture?.stop()
    child.kill()
    await child.exited
    server.stop(true)
  }
}

await main()
