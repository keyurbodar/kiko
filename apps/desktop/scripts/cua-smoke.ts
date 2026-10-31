import { mkdtemp } from "node:fs/promises"
import { connect, type Socket } from "node:net"
import { basename, join } from "node:path"
import { tmpdir } from "node:os"

const START_TIMEOUT_MS = 60_000
const CALL_TIMEOUT_MS = 180_000
const LOCATE_TIMEOUT_MS = 30_000
const POLL_MS = 100

type Reply = { id?: number; ok?: boolean; value?: unknown; error?: { code?: string; message?: string } }

type CuaWindow = { pid: number; id: number; title: string }

type Fixture = { title: string; decoy: string; stop(): Promise<void> }

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
  if (process.platform === "win32") return "\\\\.\\pipe\\kiko-driver"
  return join(app, "driver.sock")
}

async function connectDriver(path: string): Promise<Driver> {
  const deadline = Date.now() + START_TIMEOUT_MS
  for (;;) {
    try {
      return await Driver.connect(path)
    } catch (error) {
      if (Date.now() >= deadline) throw new Error(`the kiko driver socket ${path} never opened: ${String(error)}`)
    }
    await Bun.sleep(POLL_MS)
  }
}

function textOf(value: unknown): string {
  if (!isRecord(value)) return ""
  const content = Array.isArray(value.content) ? value.content : []
  return content
    .filter(isRecord)
    .map((item) => (item.type === "text" && typeof item.text === "string" ? item.text : ""))
    .join("\n")
}

function structuredOf(value: unknown): unknown {
  return isRecord(value) ? value.structuredContent : undefined
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start < 0 || end <= start) return undefined
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      return undefined
    }
  }
}

function windowsOf(value: unknown): CuaWindow[] {
  const structured = structuredOf(value)
  const fromStructured = isRecord(structured) && Array.isArray(structured.windows) ? structured.windows : undefined
  const parsed = parseJson(textOf(value))
  const rows = fromStructured ?? (Array.isArray(parsed) ? parsed : isRecord(parsed) ? parsed.windows : undefined)
  if (Array.isArray(rows)) {
    return rows.flatMap((row) => {
      if (!isRecord(row)) return []
      const id = Number(row.window_id)
      const pid = Number(row.pid)
      if (!Number.isFinite(id) || !Number.isFinite(pid)) return []
      return [{ pid, id, title: String(row.title ?? "") }]
    })
  }
  const windows: CuaWindow[] = []
  for (const line of textOf(value).split("\n")) {
    const id = line.match(/window_id[=:]\s*(\d+)/)?.[1]
    const pid = line.match(/pid[=:]\s*(\d+)/)?.[1] ?? line.match(/\(pid (\d+)\)/)?.[1]
    const title = line.match(/"([^"]*)"/)?.[1]
    if (id && pid && title !== undefined) windows.push({ pid: Number(pid), id: Number(id), title })
  }
  return windows
}

const TEXT_ROLES = new Set([
  "entry",
  "text",
  "text area",
  "text field",
  "textfield",
  "text box",
  "textbox",
  "textarea",
  "edit",
  "document",
])

function tokenOf(text: string): string | undefined {
  const snapshot = text.match(/snapshot_id=([A-Za-z0-9]+)/)?.[1]
  if (!snapshot) return undefined
  for (const line of text.split("\n")) {
    const row = line.match(/^\s*- \[(\d+)\] (.+)$/)
    if (!row) continue
    const role = (row[2] ?? "").split('"')[0]?.trim().toLowerCase() ?? ""
    if (TEXT_ROLES.has(role)) return `${snapshot}:${row[1]}`
  }
  return undefined
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
  if (process.platform === "win32")
    return command([
      "powershell",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(import.meta.dir, "fixtures", "frontmost.ps1"),
    ])
  return command(["xdotool", "getactivewindow", "getwindowname"])
}

async function frontAwayFrom(fixture: Fixture): Promise<string> {
  const deadline = Date.now() + 10_000
  for (;;) {
    await focusDecoy(fixture.decoy)
    await Bun.sleep(200)
    const front = await frontmost()
    if (!front.includes(fixture.title) || Date.now() >= deadline) return front
  }
}

async function linuxFocus(title: string): Promise<void> {
  const found = await command(["xdotool", "search", "--name", title])
  const id = found
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
  if (id) await command(["xdotool", "windowactivate", "--sync", id])
}

async function focusDecoy(decoy: string): Promise<void> {
  try {
    if (process.platform === "darwin") await command(["open", "-a", decoy])
    else if (process.platform === "win32")
      await command([
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(import.meta.dir, "fixtures", "activate-window.ps1"),
        "-Title",
        decoy,
      ])
    else await linuxFocus(decoy)
  } catch {
    return
  }
}

async function linuxFixture(): Promise<Fixture> {
  const script = join(import.meta.dir, "fixtures", "gtk_window.py")
  const fixture = Bun.spawn(["python3", script, "kiko-cua-fixture", "seed"], { stdout: "ignore", stderr: "inherit" })
  const decoy = Bun.spawn(["python3", script, "kiko-cua-decoy", ""], { stdout: "ignore", stderr: "inherit" })
  return {
    title: "kiko-cua-fixture",
    decoy: "kiko-cua-decoy",
    stop: async () => {
      fixture.kill()
      decoy.kill()
    },
  }
}

async function macFixture(dir: string): Promise<Fixture> {
  const file = join(dir, "fixture.txt")
  await Bun.write(file, "seed")
  Bun.spawn(["open", "-g", "-a", "TextEdit", file], { stdout: "ignore", stderr: "ignore" })
  Bun.spawn(["open", "-g", "-a", "Finder", dir], { stdout: "ignore", stderr: "ignore" })
  return { title: basename(file), decoy: "Finder", stop: async () => {} }
}

async function windowsFixture(dir: string): Promise<Fixture> {
  const file = join(dir, "fixture.txt")
  await Bun.write(file, "seed")
  Bun.spawn(["notepad.exe", file], { stdout: "ignore", stderr: "ignore" })
  Bun.spawn(["explorer.exe", dir], { stdout: "ignore", stderr: "ignore" })
  return {
    title: basename(file),
    decoy: basename(dir),
    stop: async () => {
      await command(["taskkill", "/IM", "notepad.exe", "/F"]).catch(() => "")
    },
  }
}

function startFixture(dir: string): Promise<Fixture> {
  if (process.platform === "darwin") return macFixture(dir)
  if (process.platform === "win32") return windowsFixture(dir)
  return linuxFixture()
}

async function locateWindow(driver: Driver, title: string): Promise<CuaWindow> {
  const deadline = Date.now() + LOCATE_TIMEOUT_MS
  for (;;) {
    const windows = windowsOf(await driver.call("desktop.call", { name: "list_windows", args: {} }))
    const found = windows.find((window) => window.title.includes(title))
    if (found) return found
    if (Date.now() >= deadline) throw new Error(`no window titled ${title} among ${JSON.stringify(windows)}`)
    await Bun.sleep(POLL_MS)
  }
}

async function typeInto(driver: Driver, window: CuaWindow, typed: string): Promise<void> {
  const state = await driver.call("desktop.call", {
    name: "get_window_state",
    args: { pid: window.pid, window_id: window.id, include_screenshot: false },
  })
  const element = tokenOf(textOf(state))
  if (!element) throw new Error(`no text field in the window state: ${textOf(state).slice(0, 400)}`)
  const target = { kind: "window", pid: window.pid, window_id: window.id }
  const inserted = await driver.call("desktop.call", {
    name: "type_text",
    args: { target, element_token: element, text: typed },
  })
  if (isRecord(inserted) && inserted.isError === true)
    throw new Error(`type_text failed: ${textOf(inserted).slice(0, 400)}`)
  const after = await driver.call("desktop.call", {
    name: "get_window_state",
    args: { pid: window.pid, window_id: window.id, include_screenshot: false },
  })
  if (!textOf(after).includes(typed))
    throw new Error(`the window does not show ${typed}: ${textOf(after).slice(0, 400)}`)
}

async function main(): Promise<void> {
  const kiko = required("KIKO_BIN")
  const cua = required("KIKO_CUA")
  const typed = process.env.KIKO_SMOKE_TYPED ?? "kiko cua typed this"
  const dir = await mkdtemp(join(tmpdir(), "kiko-cua-smoke-"))
  const app = join(dir, "app")
  const child = Bun.spawn([kiko], {
    env: {
      ...process.env,
      KIKO_APP_DIR: app,
      KIKO_COMPUTER_DIR: join(app, "computer"),
      KIKO_CORE: kiko,
      KIKO_CORE_STUB_LOG: join(app, "starts.log"),
      KIKO_CUA: cua,
    },
    stdout: "ignore",
    stderr: "inherit",
  })
  let driver: Driver | null = null
  let fixture: Fixture | null = null
  try {
    driver = await connectDriver(socketPath(app))
    const info = await driver.call("desktop.tools")
    const record = isRecord(info) ? info : {}
    const tools = Array.isArray(record.tools) ? record.tools.filter(isRecord) : []
    const names = tools.flatMap((tool) => (typeof tool.name === "string" ? [tool.name] : []))
    if (names.length === 0) throw new Error("the desktop engine listed no tools")

    fixture = await startFixture(dir)
    const window = await locateWindow(driver, fixture.title)
    const before = await frontAwayFrom(fixture)
    await typeInto(driver, window, typed)
    const after = await frontmost()
    if (before !== after || after.includes(fixture.title))
      throw new Error(`the desktop action changed the front window: ${before} -> ${after}`)

    console.log(
      JSON.stringify({
        ok: true,
        version: record.version,
        toolCount: names.length,
        toolNames: names,
        window,
        typed,
        frontBefore: before,
        frontAfter: after,
      }),
    )
  } finally {
    driver?.close()
    await fixture?.stop()
    child.kill()
    await child.exited
  }
}

await main()
