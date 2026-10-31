import { execFile, spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { readTopology, type EnvComputer } from "../tasks/env/topology"
import type { Contender, Image, Machine, ToolResult, ToolSpec } from "../types"
import { serverToolSpecs } from "./server-tools"

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const DAEMON = join(ROOT, "apps/computer/src/index.ts")
const FAKE_DRIVER = join(ROOT, "apps/bench/fixtures/fake-desktop.ts")
const WRANGLER = join(ROOT, "apps/bench/node_modules/wrangler/bin/wrangler.js")
const SERVER = join(ROOT, "apps/server")
const BENCH_ROOM = "01900000-0000-7000-8000-00000000beef"
const AGENT = "bench"
const MAX_OUTPUT_CHARS = 12_000
const MAX_READ_BYTES = 64_000
const SHELL_TIMEOUT_MS = 60_000
const CALL_TIMEOUT_MS = 60_000
const ONLINE_MS = 20_000
const ONLINE_STEP_MS = 100
const WORKER_READY_MS = 120_000
const DRIVER_MS = 5_000
const DRIVER_STEP_MS = 50

type Bag = Record<string, unknown>

const isBag = (value: unknown): value is Bag => typeof value === "object" && value !== null
const bagOf = (value: unknown): Bag => (isBag(value) ? value : {})
const stringOf = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)
const numberOr = (value: unknown, fallback: number): number => (typeof value === "number" ? value : fallback)
const text = (value: string, isError = false): ToolResult => ({ text: value, images: [], isError })
const cut = (value: string): string =>
  value.length > MAX_OUTPUT_CHARS ? `${value.slice(0, MAX_OUTPUT_CHARS - 1)}…` : value
const tail = (value: string): string =>
  value.length > MAX_OUTPUT_CHARS ? `…${value.slice(value.length - MAX_OUTPUT_CHARS + 1)}` : value

interface Computer {
  readonly id: string
  readonly name: string
  readonly os: string
  readonly online: boolean
  readonly caps: Record<string, boolean | undefined>
}

interface CallOutcome {
  readonly ok: boolean
  readonly value?: unknown
  readonly code?: string
  readonly message?: string
  readonly opMs?: number
}

interface LocalWorker {
  readonly url: URL
  dispose(): Promise<void>
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address !== null ? address.port : 0
      server.close(() => (port > 0 ? resolve(port) : reject(new Error("no free port"))))
    })
  })
}

async function startWorker(): Promise<LocalWorker> {
  const dir = await mkdtemp(join(tmpdir(), "kiko-bench-worker-"))
  const assets = join(dir, "assets")
  await mkdir(assets)
  const port = await freePort()
  const url = new URL(`http://127.0.0.1:${port}/`)
  const child = spawn(
    "node",
    [
      WRANGLER,
      "dev",
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
      "--local",
      "--persist-to",
      join(dir, "state"),
      "--assets",
      assets,
      "--var",
      `SESSION_SECRET:${randomBytes(32).toString("hex")}`,
      "--var",
      `CREDENTIALS_KEK:${randomBytes(32).toString("base64")}`,
      "--define",
      'process.env.NODE_ENV:"development"',
    ],
    { cwd: SERVER, stdio: ["ignore", "pipe", "pipe"], detached: true },
  )
  let output = ""
  const collect = (chunk: Buffer) => {
    output = `${output}${chunk.toString()}`.slice(-8_000)
  }
  child.stdout?.on("data", collect)
  child.stderr?.on("data", collect)
  child.unref()
  const ready = await waitFor(
    async () => {
      if (child.exitCode !== null) throw new Error(`wrangler dev exited: ${output.slice(-2_000)}`)
      const response = await fetch(new URL("api/health", url), { signal: AbortSignal.timeout(2_000) })
      return response.ok ? true : undefined
    },
    WORKER_READY_MS,
    ONLINE_STEP_MS,
  )
  if (!ready) {
    killGroup(child)
    throw new Error(`the bench Worker did not answer on ${url.href}: ${output.slice(-2_000)}`)
  }
  return {
    url,
    async dispose() {
      killGroup(child)
      await rm(dir, { recursive: true, force: true })
    },
  }
}

function killGroup(child: ChildProcess): void {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, "SIGKILL")
  } catch {
    try {
      child.kill("SIGKILL")
    } catch {}
  }
}

async function signIn(url: URL): Promise<string> {
  const response = await fetch(new URL("api/auth/dev/session", url), {
    method: "POST",
    headers: { "content-type": "application/json", origin: url.origin },
    body: JSON.stringify({ name: "bench" }),
  })
  if (!response.ok) throw new Error(`sign in answered ${response.status}`)
  const body = (await response.json()) as { token?: unknown }
  if (typeof body.token !== "string") throw new Error("sign in returned no token")
  return body.token
}

class Remote {
  constructor(
    readonly url: URL,
    private readonly token: string,
  ) {}

  async post(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(new URL(path, this.url), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
      body: JSON.stringify(body),
    })
    const answer = (await response.json().catch(() => null)) as unknown
    if (!response.ok) throw new Error(`${path} answered ${response.status}: ${JSON.stringify(answer).slice(0, 300)}`)
    return answer
  }

  async computers(): Promise<Computer[]> {
    return (await this.post("api/dev/user/computer", { action: "list" })) as Computer[]
  }

  async pairCode(): Promise<string> {
    const body = (await this.post("api/dev/user/computer", { action: "pair" })) as { code?: unknown }
    if (typeof body.code !== "string") throw new Error("the worker minted no pairing code")
    return body.code
  }

  async desktop(pcId?: string): Promise<Bag[]> {
    const info = (await this.post("api/dev/user/computer", {
      action: "desktop",
      ...(pcId ? { pcId } : {}),
    })) as Bag | null
    const tools = info?.tools
    return Array.isArray(tools) ? tools.filter(isBag) : []
  }

  call(pcId: string, op: string, args: unknown, deadlineMs: number): Promise<CallOutcome> {
    return this.post("api/dev/user/computer", {
      action: "call",
      agentId: AGENT,
      roomId: BENCH_ROOM,
      pcId,
      op,
      args,
      deadlineMs,
    }) as Promise<CallOutcome>
  }
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor<T>(
  read: () => Promise<T | undefined>,
  budgetMs: number,
  stepMs: number,
): Promise<T | undefined> {
  const deadline = Date.now() + budgetMs
  for (;;) {
    const value = await read().catch(() => undefined)
    if (value !== undefined) return value
    if (Date.now() >= deadline) return undefined
    await pause(stepMs)
  }
}

function daemonPair(dir: string, url: URL, code: string, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "bun",
      [DAEMON, "pair", `${url.origin}/pc#${code}`, "--name", name, "--dir", dir],
      { cwd: dir, timeout: 60_000 },
      (error) => (error ? reject(error) : resolve()),
    )
  })
}

function daemonRun(dir: string, driverPath?: string): ChildProcess {
  const child = spawn("bun", [DAEMON, "run", "--dir", dir], {
    cwd: dir,
    env: { ...process.env, HOME: dir, ...(driverPath ? { KIKO_DRIVER: driverPath } : {}) },
    stdio: "ignore",
    detached: true,
  })
  child.unref()
  return child
}

async function writePolicy(dir: string): Promise<void> {
  const policy = { shell: true, files: { allow: [dir] }, desktop: true, live: false, input: true }
  await writeFile(join(dir, "policy.json"), JSON.stringify(policy, null, 2), "utf8")
}

async function startFakeDriver(dir: string): Promise<{ socket: string; process: ChildProcess }> {
  const socket = join(dir, "desktop.sock")
  const process = spawn("bun", [FAKE_DRIVER, socket], { cwd: dir, stdio: "ignore", detached: true })
  process.unref()
  const ready = await waitFor(async () => (existsSync(socket) ? true : undefined), DRIVER_MS, DRIVER_STEP_MS)
  if (!ready) throw new Error("the fake desktop driver did not open its socket")
  return { socket, process }
}

function kikoVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Bag
    return `kiko-remote@${typeof pkg.version === "string" ? pkg.version : "unknown"}`
  } catch {
    return "kiko-remote@unknown"
  }
}

const PC_PROPERTY = { type: "string", description: "the computer's name or id" }

function withPC(schema: unknown): Bag {
  const body = isBag(schema) ? schema : {}
  const properties = isBag(body.properties) ? body.properties : {}
  return { ...body, type: "object", properties: { ...properties, pc: PC_PROPERTY } }
}

function desktopSpecs(tools: readonly Bag[]): ToolSpec[] {
  return tools.flatMap((tool) => {
    const name = stringOf(tool.name)
    if (!name) return []
    return [
      {
        name: `desktop_${name}`,
        description: stringOf(tool.description)?.trim() || `run the machine's ${name} desktop tool`,
        parameters: withPC(tool.inputSchema),
      },
    ]
  })
}

const IMAGE_MIMES = new Set(["image/png", "image/jpeg"])

function contentResult(value: unknown, pc: Computer): ToolResult {
  const record = bagOf(value)
  const content = Array.isArray(record.content) ? record.content : []
  const texts: string[] = []
  const images: Image[] = []
  for (const item of content) {
    const part = bagOf(item)
    if (part.type === "text" && typeof part.text === "string") texts.push(part.text)
    if (part.type === "image" && typeof part.data === "string" && IMAGE_MIMES.has(String(part.mimeType)))
      images.push({ mime: part.mimeType as Image["mime"], base64: part.data })
  }
  const body = cut(texts.join("\n").trim() || `the desktop tool ran on ${pc.name} and returned no text`)
  return { text: body, images, isError: record.isError === true }
}

function statusOf(value: Bag): string {
  return value.status === "running" ? "running" : `exited with code ${value.exitCode ?? "unknown"}`
}

function bodyOf(value: string, truncated: boolean): string {
  const notes: string[] = []
  if (truncated) notes.push("older output was cut")
  if (value.length > MAX_OUTPUT_CHARS) notes.push(`only the last ${MAX_OUTPUT_CHARS} characters are shown`)
  const shown = value.length > MAX_OUTPUT_CHARS ? `…${value.slice(value.length - MAX_OUTPUT_CHARS + 1)}` : value
  const body = shown.trim() ? shown : "(no output)"
  return notes.length > 0 ? `${notes.join("; ")}\n\n${body}` : body
}

function failText(code: string | undefined, message: string | undefined, pc: Computer): string {
  const reason = (message ?? "").trim()
  const detail = reason ? ` (${reason})` : ""
  switch (code) {
    case "denied":
      return `The owner's policy on ${pc.name} blocks this.${detail}`
    case "busy":
      return `The human has control of ${pc.name}, so nothing ran.${detail}`
    case "timeout":
      return `${pc.name} did not answer in time, so it may still be running that.${detail}`
    case "unsupported":
      return `${pc.name} cannot do this: ${reason || "its daemon does not support that op."}`
    case "cancelled":
      return `the call to ${pc.name} was cancelled.${detail}`
    default:
      return reason || `${pc.name} failed that call.`
  }
}

function browserMethod(name: string): string | undefined {
  const methods: Readonly<Record<string, string>> = {
    browser_tabs: "browser.tabs",
    browser_read: "browser.read",
    browser_act: "browser.act",
    browser_open: "browser.open",
    browser_close: "browser.close",
    browser_show: "browser.show",
  }
  return methods[name]
}

export type Route =
  | { readonly kind: "local" }
  | { readonly kind: "op"; readonly op: string }
  | { readonly kind: "driver"; readonly method: string }

export function routeOf(name: string): Route | undefined {
  if (name === "computer_list") return { kind: "local" }
  if (name === "computer_shell") return { kind: "op", op: "shell" }
  if (name === "computer_read") return { kind: "op", op: "read" }
  if (name === "computer_write") return { kind: "op", op: "write" }
  if (name.startsWith("desktop_")) return { kind: "driver", method: "desktop.call" }
  const method = browserMethod(name)
  if (method) return { kind: "driver", method }
  if (name.startsWith("terminal_")) return { kind: "op", op: name }
  return undefined
}

function driverResult(pc: Computer, tool: string, value: unknown): ToolResult {
  if (tool === "browser_tabs") {
    const tabs = Array.isArray(value) ? (value as Bag[]) : []
    if (tabs.length === 0) return text(`no browser tabs are open on ${pc.name}.`)
    return text(
      tabs
        .map((tab) => `${tab.id}${tab.active ? " [in front]" : ""} ${tab.title || "(no title)"} — ${tab.url}`)
        .join("\n"),
    )
  }
  if (tool === "browser_read" || tool === "browser_act") {
    const page = bagOf(value)
    const tab = bagOf(page.tab)
    const head = `${tab.title || "(no title)"} — ${tab.url} (tab ${tab.id}, read in the background)`
    const body = cut([head, stringOf(page.outline)?.trim() || "(no controls on this page)"].join("\n\n"))
    const image = bagOf(page.image)
    const images: Image[] =
      typeof image.data === "string" && IMAGE_MIMES.has(String(image.mimeType))
        ? [{ mime: image.mimeType as Image["mime"], base64: image.data }]
        : []
    return { text: body, images, isError: false }
  }
  if (tool === "browser_open") {
    const tab = bagOf(value)
    return text(`opened ${tab.title || "(no title)"} — ${tab.url} on ${pc.name} in the background.`)
  }
  if (tool === "browser_close") return text(`closed the tab on ${pc.name}.`)
  if (tool === "browser_show") return text(`brought the tab to the front on ${pc.name}.`)
  return contentResult(value, pc)
}

export function kikoRemote(): Contender {
  let machine: Machine | undefined
  let worker: LocalWorker | null = null
  let remote: Remote | null = null
  let specs: ToolSpec[] = []
  let computers: Computer[] = []
  const daemons = new Map<string, ChildProcess>()
  const drivers = new Map<string, ChildProcess>()
  const dirs = new Map<string, string>()
  const restarted = new Set<string>()

  const need = (): Machine => {
    if (!machine) throw new Error("the kiko-remote contender has not started")
    return machine
  }

  const needRemote = (): Remote => {
    if (!remote) throw new Error("the kiko-remote contender has not started")
    return remote
  }

  async function topologyFor(m: Machine): Promise<EnvComputer[]> {
    const topology = await readTopology(m)
    if (topology) return [...topology.computers]
    return [{ name: "bench", dir: m.workdir }]
  }

  async function bringUp(m: Machine, computer: EnvComputer): Promise<void> {
    const dir = computer.dir
    await mkdir(dir, { recursive: true })
    dirs.set(computer.name, dir)
    await writePolicy(dir)
    const code = await needRemote().pairCode()
    await daemonPair(dir, needRemote().url, code, computer.name)
    const driver = computer.desktop ? await startFakeDriver(dir) : null
    if (driver) drivers.set(computer.name, driver.process)
    const daemon = daemonRun(dir, driver?.socket)
    daemons.set(computer.name, daemon)
    const online = await waitFor(
      async () => {
        const all = await needRemote().computers()
        const found = all.find((pc) => pc.name === computer.name && pc.online)
        return found ? found : undefined
      },
      ONLINE_MS,
      ONLINE_STEP_MS,
    )
    if (!online) throw new Error(`the daemon for ${computer.name} did not come online`)
  }

  async function restart(name: string): Promise<void> {
    const dir = dirs.get(name)
    if (!dir) return
    daemons.get(name)?.kill("SIGKILL")
    const driver = drivers.get(name)
    const daemon = daemonRun(dir, driver ? join(dir, "desktop.sock") : undefined)
    daemons.set(name, daemon)
    await waitFor(
      async () => {
        const all = await needRemote().computers()
        return all.find((pc) => pc.name === name && pc.online) ? true : undefined
      },
      ONLINE_MS,
      ONLINE_STEP_MS,
    )
  }

  function scheduleRestart(name: string, afterMs: number): void {
    if (restarted.has(name)) return
    restarted.add(name)
    setTimeout(() => void restart(name).catch(() => undefined), afterMs)
  }

  async function resolvePc(
    which: string | undefined,
  ): Promise<{ ok: true; pc: Computer } | { ok: false; result: ToolResult }> {
    computers = await needRemote().computers()
    const first = computers[0]
    if (!first) return { ok: false, result: text("no computer is paired with kiko", true) }
    const want = which?.trim()
    if (!want) {
      if (computers.length === 1) return { ok: true, pc: first }
      const names = computers.map((pc) => `${pc.name} (${pc.os}${pc.online ? "" : ", offline"})`).join(", ")
      return {
        ok: false,
        result: text(`there are ${computers.length} computers: ${names}. name the one you mean with pc.`, true),
      }
    }
    const byId = computers.find((pc) => pc.id === want)
    if (byId) return { ok: true, pc: byId }
    const named = computers.filter((pc) => pc.name.toLowerCase() === want.toLowerCase())
    const only = named[0]
    if (named.length === 1 && only) return { ok: true, pc: only }
    if (named.length > 1)
      return {
        ok: false,
        result: text(
          `${named.length} computers are called ${want}: ${named.map((pc) => `${pc.name} (${pc.id})`).join(", ")}. pass the id of the one you mean in pc.`,
          true,
        ),
      }
    return {
      ok: false,
      result: text(
        `there is no computer called ${want}. the computers are: ${computers.map((pc) => pc.name).join(", ")}.`,
        true,
      ),
    }
  }

  async function callOp(pc: Computer, op: string, args: unknown, deadlineMs: number, tool = op): Promise<ToolResult> {
    const started = performance.now()
    let outcome: CallOutcome
    try {
      outcome = await needRemote().call(pc.id, op, args, deadlineMs)
    } catch (caught) {
      return text(caught instanceof Error ? caught.message : String(caught), true)
    }
    const elapsed = performance.now() - started
    if (!outcome.ok)
      return { ...text(failText(outcome.code, outcome.message, pc), true), opMs: outcome.opMs ?? elapsed }
    return { ...format(pc, tool, op, outcome.value), opMs: outcome.opMs ?? elapsed }
  }

  function format(pc: Computer, tool: string, op: string, value: unknown): ToolResult {
    if (op === "driver") return driverResult(pc, tool, value)
    if (op === "shell") {
      const shell = bagOf(value)
      const head = [
        `exit code ${shell.exitCode ?? "none"}`,
        shell.timedOut ? "still running" : undefined,
        shell.truncated ? "the start of the output is cut" : undefined,
        `on ${pc.name}`,
      ]
        .filter(Boolean)
        .join(", ")
      const output = stringOf(shell.output) ?? ""
      return text(`${head}\n\n${output.trim() ? tail(output) : "(no output)"}`)
    }
    if (op === "read") {
      const read = bagOf(value)
      if (read.base64 !== undefined) return text(`${pc.name} returned binary data`, true)
      const note = read.truncated ? ` (cut at ${read.size} bytes)` : ""
      return text(`${read.size} bytes${note}\n\n${cut(stringOf(read.text) ?? "")}`)
    }
    if (op === "write") return text(`wrote ${bagOf(value).size} bytes on ${pc.name}`)
    if (op === "terminal_open") {
      const open = bagOf(value)
      return text(
        `opened ${open.name} (${open.id}) running ${open.shell} in ${open.cwd}, ${open.cols}x${open.rows}. it stays open between your turns: type with terminal_send, then terminal_wait or terminal_read.`,
      )
    }
    if (op === "terminal_send")
      return text(
        `sent ${bagOf(value).bytes} bytes on ${pc.name}. call terminal_wait to wait for the output, or terminal_read to see the screen.`,
      )
    if (op === "terminal_read") {
      const read = bagOf(value)
      return text(
        `${read.id} on ${pc.name}, ${read.cols}x${read.rows}, ${statusOf(read)}\n\n${bodyOf(stringOf(read.text) ?? "", read.truncated === true)}`,
      )
    }
    if (op === "terminal_wait") {
      const wait = bagOf(value)
      const head = wait.matched
        ? `found the text on ${pc.name}.`
        : wait.exited
          ? `the terminal on ${pc.name} exited while waiting.`
          : `waited and did not see the text on ${pc.name}.`
      return text(`${head}\n\n${bodyOf(stringOf(wait.text) ?? "", false)}`)
    }
    if (op === "terminal_list") {
      const list = Array.isArray(bagOf(value).terminals) ? (bagOf(value).terminals as Bag[]) : []
      if (list.length === 0) return text(`no terminal sessions are open on ${pc.name}. open one with terminal_open.`)
      const lines = list.map(
        (entry) => `${entry.id} "${entry.name}" ${entry.cwd} ${entry.cols}x${entry.rows} ${statusOf(entry)}`,
      )
      return text(`${list.length} terminal session(s) on ${pc.name}:\n${lines.join("\n")}`)
    }
    if (op === "terminal_close") return text(`closed the terminal on ${pc.name}.`)
    return contentResult(value, pc)
  }

  async function teardown(): Promise<void> {
    for (const daemon of daemons.values()) daemon.kill("SIGKILL")
    for (const driver of drivers.values()) driver.kill("SIGKILL")
    daemons.clear()
    drivers.clear()
    dirs.clear()
    restarted.clear()
    const running = worker
    worker = null
    remote = null
    specs = []
    computers = []
    machine = undefined
    await running?.dispose().catch(() => undefined)
  }

  return {
    name: "kiko-remote",
    version: kikoVersion(),
    tracks: ["terminal", "browser", "desktop", "mixed", "environment"],
    async start(m: Machine): Promise<void> {
      machine = m
      try {
        worker = await startWorker()
        const token = await signIn(worker.url)
        remote = new Remote(worker.url, token)
        const computersInTopology = await topologyFor(m)
        for (const computer of computersInTopology) await bringUp(m, computer)
        computers = await remote.computers()
        const first = computers[0]
        const desktop = first ? await remote.desktop(first.id) : []
        specs = serverToolSpecs(desktop)
      } catch (error) {
        await teardown()
        throw error
      }
    },
    tools(): readonly ToolSpec[] {
      return specs
    },
    async call(name: string, args: unknown, signal: AbortSignal): Promise<ToolResult> {
      need()
      if (signal.aborted) return text("the call was cancelled", true)
      const bag = bagOf(args)
      const which = stringOf(bag.pc)
      const { pc: _pc, ...rest } = bag
      if (name === "computer_list") {
        computers = await needRemote().computers()
        const lines = computers.map(
          (pc) =>
            `${pc.name} (id ${pc.id}): ${[
              pc.os,
              pc.online ? "online" : "offline",
              ...Object.entries(pc.caps)
                .filter(([, on]) => on === true)
                .map(([cap]) => cap),
            ].join(", ")}.`,
        )
        return text([`computers (${computers.length}):`, ...lines].join("\n"))
      }
      const target = await resolvePc(which)
      if (!target.ok) return target.result
      const pc = target.pc
      const topology = await topologyFor(need())
      const restart = topology.find((computer) => computer.name === pc.name)?.restartAfterMs
      if (restart !== undefined) scheduleRestart(pc.name, restart)
      if (name === "computer_shell") {
        const command = stringOf(rest.command)
        if (!command) return text("computer_shell needs a command", true)
        const timeoutMs = Math.min(Math.max(numberOr(rest.timeoutMs, SHELL_TIMEOUT_MS), 1_000), 590_000)
        return callOp(
          pc,
          "shell",
          { command, ...(stringOf(rest.cwd) ? { cwd: stringOf(rest.cwd) } : {}), timeoutMs },
          timeoutMs + 10_000,
        )
      }
      if (name === "computer_read") {
        const path = stringOf(rest.path)
        if (!path) return text("computer_read needs a path", true)
        const maxBytes = Math.min(Math.max(numberOr(rest.maxBytes, MAX_READ_BYTES), 1), 1_000_000)
        return callOp(pc, "read", { path, maxBytes }, CALL_TIMEOUT_MS)
      }
      if (name === "computer_write") {
        const path = stringOf(rest.path)
        if (path === undefined) return text("computer_write needs a path", true)
        if (rest.text === undefined) return text("computer_write needs text", true)
        return callOp(
          pc,
          "write",
          { path, text: rest.text, ...(rest.append === true ? { append: true } : {}) },
          CALL_TIMEOUT_MS,
        )
      }
      if (name.startsWith("desktop_")) {
        return callOp(
          pc,
          "driver",
          { method: "desktop.call", params: { name: name.slice("desktop_".length), args: rest } },
          CALL_TIMEOUT_MS,
          name,
        )
      }
      const method = browserMethod(name)
      if (method) return callOp(pc, "driver", { method, params: rest }, CALL_TIMEOUT_MS, name)
      if (name.startsWith("terminal_")) return callOp(pc, name, rest, CALL_TIMEOUT_MS)
      return text(`there is no tool called ${name}`, true)
    },
    async stop(): Promise<void> {
      await teardown()
    },
  }
}
