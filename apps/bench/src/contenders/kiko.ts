import { readFileSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"
import type { DesktopInfo, DesktopTool, Page, PageAction, Tab } from "@kiko/computer/driver"
import type { Value } from "@kiko/computer/wire"
import { Deadline } from "@kiko/computer-daemon/src/deadline.ts"
import { startDriver, type Driver } from "@kiko/computer-daemon/src/driver.ts"
import { createLogger, failureMessage } from "@kiko/computer-daemon/src/log.ts"
import { read, shell, write } from "@kiko/computer-daemon/src/ops.ts"
import type { Policy } from "@kiko/computer-daemon/src/config.ts"
import { TerminalManager } from "@kiko/computer-daemon/src/terminal/manager.ts"
import type { Contender, Image, Machine, ToolResult, ToolSpec } from "../types"
import { KIKO_TOOLS } from "./kiko-schemas"

const SHELL_TIMEOUT_MS = 60_000
const CALL_TIMEOUT_MS = 60_000
const MAX_OUTPUT_CHARS = 12_000
const MAX_READ_BYTES = 64_000
const SCREEN_MAX_WIDTH = 960
const BROWSER_STEPS_MAX = 20
const DRIVER_TRACKS: ReadonlySet<string> = new Set(["browser", "desktop", "mixed", "cross"])
const TERMINAL_TOOLS = new Set([
  "terminal_open",
  "terminal_send",
  "terminal_read",
  "terminal_wait",
  "terminal_list",
  "terminal_close",
])

type Bag = Record<string, unknown>

const isBag = (value: unknown): value is Bag => typeof value === "object" && value !== null

const bagOf = (value: unknown): Bag => (isBag(value) ? value : {})

const stringOf = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)

const whole = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined

const text = (value: string, isError = false): ToolResult => ({ text: value, images: [], isError })

const cut = (value: string): string =>
  value.length > MAX_OUTPUT_CHARS ? `${value.slice(0, MAX_OUTPUT_CHARS - 1)}…` : value

const tail = (value: string): string =>
  value.length > MAX_OUTPUT_CHARS ? `…${value.slice(value.length - MAX_OUTPUT_CHARS + 1)}` : value

function kikoVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../../../package.json", import.meta.url), "utf8")) as Bag
    return `kiko@${typeof pkg.version === "string" ? pkg.version : "unknown"}`
  } catch {
    return "kiko@unknown"
  }
}

function policyFor(machine: Machine): Policy {
  return { shell: true, files: { allow: [machine.workdir] }, desktop: false, live: false, input: false }
}

function deadlineFor(ms: number, signal: AbortSignal): Deadline {
  const deadline = new Deadline(Math.max(1_000, ms))
  if (signal.aborted) deadline.controller.abort(signal.reason)
  else signal.addEventListener("abort", () => deadline.controller.abort(signal.reason), { once: true })
  return deadline
}

function shellHead(value: Value<"shell">, machine: Machine, timeoutMs: number): string {
  return [
    `exit code ${value.exitCode ?? "none"}`,
    value.timedOut ? `still running after ${Math.round(timeoutMs / 1000)} s` : undefined,
    value.truncated ? "the start of the output is cut" : undefined,
    `on ${machine.id}`,
  ]
    .filter(Boolean)
    .join(", ")
}

const pathIn = (machine: Machine, path: string): string => (isAbsolute(path) ? path : resolve(machine.workdir, path))

async function shellCall(machine: Machine, args: Bag, signal: AbortSignal): Promise<ToolResult> {
  const command = stringOf(args.command)
  if (!command) return text("computer_shell needs a command", true)
  const timeoutMs = Math.min(
    Math.max(typeof args.timeoutMs === "number" ? args.timeoutMs : SHELL_TIMEOUT_MS, 1_000),
    590_000,
  )
  const cwd = pathIn(machine, stringOf(args.cwd) ?? machine.workdir)
  try {
    const value = await shell({ command, cwd, timeoutMs }, policyFor(machine), deadlineFor(timeoutMs + 10_000, signal))
    return text(
      `${shellHead(value, machine, timeoutMs)}\n\n${value.output.trim() ? tail(value.output) : "(no output)"}`,
    )
  } catch (error) {
    return text(failureMessage(error), true)
  }
}

async function readCall(machine: Machine, args: Bag, signal: AbortSignal): Promise<ToolResult> {
  const raw = stringOf(args.path)
  if (!raw) return text("computer_read needs a path", true)
  const path = pathIn(machine, raw)
  const maxBytes = Math.min(Math.max(typeof args.maxBytes === "number" ? args.maxBytes : MAX_READ_BYTES, 1), 1_000_000)
  try {
    const value = await read({ path, maxBytes }, policyFor(machine), deadlineFor(CALL_TIMEOUT_MS, signal))
    if (value.base64 !== undefined)
      return text(
        `${path} on ${machine.id} is binary, ${value.size} bytes. use computer_shell for it, such as \`file\` or \`head -c 200\`.`,
        true,
      )
    const note = value.truncated ? ` (cut at ${maxBytes} bytes of ${value.size})` : ""
    return text(`${path} on ${machine.id}, ${value.size} bytes${note}\n\n${cut(value.text ?? "")}`)
  } catch (error) {
    return text(failureMessage(error), true)
  }
}

async function writeCall(machine: Machine, args: Bag, signal: AbortSignal): Promise<ToolResult> {
  const raw = stringOf(args.path)
  const body = stringOf(args.text)
  if (!raw) return text("computer_write needs a path", true)
  const path = pathIn(machine, raw)
  if (body === undefined) return text("computer_write needs text", true)
  try {
    const value = await write(
      { path, text: body, ...(args.append === true ? { append: true } : {}) },
      policyFor(machine),
      deadlineFor(CALL_TIMEOUT_MS, signal),
    )
    return text(`wrote ${value.size} bytes to ${path} on ${machine.id}`)
  } catch (error) {
    return text(failureMessage(error), true)
  }
}

const PC_PROPERTY = {
  type: "string",
  description: "the computer's name or id. leave it out when the owner has one computer",
}

const IMAGE_MIMES = new Set(["image/png", "image/jpeg"])

function withPC(schema: unknown): Bag {
  const body = isBag(schema) ? schema : {}
  const properties = isBag(body.properties) ? body.properties : {}
  return { ...body, type: "object", properties: { ...properties, pc: PC_PROPERTY } }
}

function desktopSpec(tool: DesktopTool): ToolSpec {
  return {
    name: `desktop_${tool.name}`,
    description: tool.description?.trim() || `run the machine's ${tool.name} desktop tool`,
    parameters: withPC(tool.inputSchema),
  }
}

async function loadDesktopTools(driver: Driver): Promise<DesktopTool[]> {
  const signal = new AbortController().signal
  try {
    const info = (await driver.call({ method: "desktop.tools" }, deadlineFor(CALL_TIMEOUT_MS, signal))) as DesktopInfo
    return Array.isArray(info?.tools) ? info.tools : []
  } catch {
    return []
  }
}

function mcpResult(value: unknown, machine: Machine): ToolResult {
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
  const body = cut(texts.join("\n").trim() || `the desktop tool ran on ${machine.id} and returned no text`)
  return { text: body, images, isError: record.isError === true }
}

async function desktopCall(
  driver: Driver,
  machine: Machine,
  tool: string,
  args: Bag,
  deadline: Deadline,
): Promise<ToolResult> {
  const { pc: _pc, ...rest } = args
  const value = await driver.call({ method: "desktop.call", params: { name: tool, args: rest } }, deadline)
  return mcpResult(value, machine)
}

function tabLine(tab: Tab): string {
  return `${tab.id}${tab.active ? " [in front]" : ""} ${tab.title || "(no title)"} — ${tab.url}`
}

function pageHead(page: Page): string {
  return `${page.tab.title || "(no title)"} — ${page.tab.url} (tab ${page.tab.id}, read in the background)`
}

function pageResult(page: Page, head: string, isError = false): ToolResult {
  const image = page.image
  return {
    text: cut(`${head}\n\n${page.outline.trim() || "(no controls on this page)"}`),
    images: image && IMAGE_MIMES.has(image.mime) ? [{ mime: image.mime as Image["mime"], base64: image.data }] : [],
    isError,
  }
}

async function readPage(driver: Driver, tab: string, image: boolean, deadline: Deadline): Promise<Page> {
  const value = await driver.call(
    { method: "browser.read", params: { tab, image, max_width: SCREEN_MAX_WIDTH } },
    deadline,
  )
  return value as Page
}

async function browserAct(driver: Driver, args: Bag, deadline: Deadline): Promise<ToolResult> {
  const tab = stringOf(args.tab)
  if (!tab) return text("browser_act needs a tab", true)
  const wanted = Array.isArray(args.steps) ? args.steps.filter(isBag) : []
  if (wanted.length === 0) return text("browser_act needs steps", true)
  const mode = args.on_screen === true ? "foreground" : "background"
  const steps = wanted.slice(0, BROWSER_STEPS_MAX).map((step) => ({
    ref: typeof step.ref === "number" ? step.ref : Number.NaN,
    action: String(step.action ?? "") as PageAction,
    text: stringOf(step.text),
  }))
  let done = 0
  let failure: string | undefined
  while (done < steps.length && failure === undefined) {
    const step = steps[done]!
    try {
      await driver.call(
        {
          method: "browser.act",
          params: {
            tab,
            ref: step.ref,
            action: step.action,
            mode,
            ...(step.text !== undefined ? { text: step.text } : {}),
          },
        },
        deadline,
      )
      done += 1
    } catch (error) {
      failure = failureMessage(error)
    }
  }
  const progress = `did ${done} of ${steps.length} steps`
  try {
    const page = await readPage(driver, tab, args.image === true, deadline)
    const trouble = failure ? `. step ${done + 1} failed: ${failure}` : ""
    return pageResult(page, `${progress} on ${pageHead(page)}${trouble}`, failure !== undefined)
  } catch (error) {
    return text(`${progress}. the page could not be read: ${failureMessage(error)}`, true)
  }
}

async function browserCall(driver: Driver, name: string, args: Bag, deadline: Deadline): Promise<ToolResult> {
  if (name === "browser_tabs") {
    const tabs = (await driver.call({ method: "browser.tabs" }, deadline)) as Tab[]
    return text(tabs.map(tabLine).join("\n") || "no browser tabs are open.")
  }
  if (name === "browser_open") {
    const url = stringOf(args.url)
    if (!url) return text("browser_open needs a url", true)
    const opened = (await driver.call({ method: "browser.open", params: { url, mode: "background" } }, deadline)) as Tab
    return text(`opened ${tabLine(opened)} in the background.`)
  }
  if (name === "browser_act") return browserAct(driver, args, deadline)
  const tab = stringOf(args.tab)
  if (!tab) return text(`${name} needs a tab`, true)
  if (name === "browser_read") {
    const page = await readPage(driver, tab, args.image === true, deadline)
    return pageResult(page, pageHead(page))
  }
  if (name === "browser_close") {
    await driver.call({ method: "browser.close", params: { tab } }, deadline)
    return text(`closed tab ${tab}.`)
  }
  if (name === "browser_show") {
    await driver.call({ method: "browser.show", params: { tab } }, deadline)
    return text(`brought tab ${tab} to the front.`)
  }
  return text(`there is no tool called ${name}`, true)
}

const terminalStatus = (value: { status: "running" | "exited"; exitCode: number | null }): string =>
  value.status === "running" ? "running" : `exited with code ${value.exitCode === null ? "unknown" : value.exitCode}`

const bodyOf = (value: string, truncated: boolean): string => {
  const notes = [truncated ? "older output was cut" : ""].filter(Boolean)
  const body = value.trim() ? value : "(no output)"
  return notes.length > 0 ? `${notes.join("; ")}\n\n${body}` : body
}

function terminalOpen(terminals: TerminalManager, machine: Machine, args: Bag): ToolResult {
  const shell = stringOf(args.shell)
  const name = stringOf(args.name)
  const cols = whole(args.cols)
  const rows = whole(args.rows)
  const value = terminals.open({
    cwd: pathIn(machine, stringOf(args.cwd) ?? machine.workdir),
    ...(shell ? { shell } : {}),
    ...(cols ? { cols } : {}),
    ...(rows ? { rows } : {}),
    ...(name ? { name } : {}),
  })
  return text(
    `opened ${value.name} (${value.id}) running ${value.shell} in ${value.cwd}, ${value.cols}x${value.rows}. it stays open between your turns: type with terminal_send, then terminal_wait or terminal_read.`,
  )
}

async function terminalSend(
  terminals: TerminalManager,
  machine: Machine,
  args: Bag,
  signal: AbortSignal,
): Promise<ToolResult> {
  const id = stringOf(args.id)
  if (!id) return text("terminal_send needs an id from terminal_open or terminal_list", true)
  const typed = stringOf(args.text)
  const keys = Array.isArray(args.keys) ? args.keys.filter((key): key is string => typeof key === "string") : []
  if (typed === undefined && keys.length === 0) return text("terminal_send needs text or keys", true)
  const until = stringOf(args.until)?.trim()
  const timeoutMs = whole(args.timeoutMs)
  const value = await terminals.send(
    {
      id,
      ...(typed !== undefined ? { text: typed } : {}),
      ...(keys.length ? { keys } : {}),
      ...(until ? { until } : {}),
      ...(args.regex === true ? { regex: true } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
    },
    signal,
  )
  const sent = `sent ${value.bytes} bytes to ${id} on ${machine.id}`
  if (!until) return text(`${sent}. call terminal_wait to wait for the output, or terminal_read to see the screen.`)
  const head = value.matched
    ? `${sent} and found ${JSON.stringify(until)}.`
    : value.exited
      ? `${sent}; it exited while waiting for ${JSON.stringify(until)}.`
      : `${sent}; waited ${Math.round((timeoutMs ?? 30_000) / 1000)} s and did not see ${JSON.stringify(until)}.`
  return text(`${head}\n\n${bodyOf(value.text ?? "", false)}`)
}

async function terminalRead(terminals: TerminalManager, args: Bag): Promise<ToolResult> {
  const id = stringOf(args.id)
  if (!id) return text("terminal_read needs an id from terminal_open or terminal_list", true)
  const mode = args.mode === "screen" ? "screen" : args.mode === "tail" ? "tail" : undefined
  if (!mode) return text("terminal_read needs mode screen or tail", true)
  const lines = whole(args.lines)
  const value = await terminals.read({ id, mode, ...(lines ? { lines } : {}) })
  const head = `${value.id}, ${value.cols}x${value.rows}, ${terminalStatus(value)}`
  return text(`${head}\n\n${bodyOf(value.text, value.truncated)}`)
}

async function terminalWait(terminals: TerminalManager, args: Bag, signal: AbortSignal): Promise<ToolResult> {
  const id = stringOf(args.id)
  const until = stringOf(args.until)
  if (!id) return text("terminal_wait needs an id from terminal_open or terminal_list", true)
  if (!until?.trim()) return text("terminal_wait needs some text to look for", true)
  const timeoutMs = whole(args.timeoutMs)
  const value = await terminals.wait(
    { id, until, ...(args.regex === true ? { regex: true } : {}), ...(timeoutMs ? { timeoutMs } : {}) },
    signal,
  )
  const head = value.matched
    ? `found ${JSON.stringify(until)} in ${id}.`
    : value.exited
      ? `${id} exited while waiting for ${JSON.stringify(until)}.`
      : `waited and did not see ${JSON.stringify(until)} in ${id}.`
  return text(`${head}\n\n${bodyOf(value.text, false)}`)
}

function terminalList(terminals: TerminalManager, machine: Machine): ToolResult {
  const value = terminals.list()
  if (value.terminals.length === 0)
    return text(`no terminal sessions are open on ${machine.id}. open one with terminal_open.`)
  const lines = value.terminals.map(
    (terminal) =>
      `${terminal.id} "${terminal.name}" ${terminal.cwd} ${terminal.cols}x${terminal.rows} ${terminalStatus(terminal)}`,
  )
  return text(`${value.terminals.length} terminal session(s) on ${machine.id}:\n${lines.join("\n")}`)
}

async function terminalClose(terminals: TerminalManager, machine: Machine, args: Bag): Promise<ToolResult> {
  const id = stringOf(args.id)
  if (!id) return text("terminal_close needs an id from terminal_open or terminal_list", true)
  await terminals.close({ id })
  return text(`closed ${id} on ${machine.id}.`)
}

export interface KikoOptions {
  readonly driver?: Driver
  readonly terminals?: TerminalManager
}

export function kikoContender(options: KikoOptions = {}): Contender {
  let machine: Machine | undefined
  let driver: Driver | null = options.driver ?? null
  let desktop: DesktopTool[] = []
  let terminals: TerminalManager | undefined = options.terminals
  let owned = false

  const need = (): Machine => {
    if (!machine) throw new Error("the kiko contender has not started")
    return machine
  }

  const withDriver = async (call: (driver: Driver) => Promise<ToolResult>): Promise<ToolResult> => {
    if (!driver) return text("the kiko app is not connected on this machine, so background desktop work is off", true)
    try {
      return await call(driver)
    } catch (error) {
      return text(failureMessage(error), true)
    }
  }

  const withTerminals = async (
    call: (terminals: TerminalManager) => Promise<ToolResult> | ToolResult,
  ): Promise<ToolResult> => {
    if (!terminals) return text("the kiko app is not connected on this machine, so terminals are off", true)
    try {
      return await call(terminals)
    } catch (error) {
      return text(failureMessage(error), true)
    }
  }

  return {
    name: "kiko",
    version: kikoVersion(),
    tracks: ["terminal", "browser", "desktop", "mixed"],
    async start(m: Machine): Promise<void> {
      machine = m
      terminals ??= new TerminalManager()
      const path = process.env.KIKO_DRIVER
      if (!driver && path) {
        driver = startDriver({ path, log: createLogger("kiko-bench") })
        owned = true
      }
      desktop = driver ? await loadDesktopTools(driver) : []
      const track = process.env.BENCH_TRACK
      if (track && DRIVER_TRACKS.has(track) && (!driver || desktop.length === 0)) {
        if (owned) driver?.close()
        driver = options.driver ?? null
        desktop = []
        owned = false
        throw new Error(
          `the ${track} track needs the kiko app driver: start kiko-app and point KIKO_DRIVER at its driver.sock`,
        )
      }
    },
    tools(): readonly ToolSpec[] {
      return [...KIKO_TOOLS, ...desktop.map(desktopSpec)]
    },
    async call(name: string, args: unknown, signal: AbortSignal): Promise<ToolResult> {
      const m = need()
      const bag = bagOf(args)
      if (name === "computer_shell") return shellCall(m, bag, signal)
      if (name === "computer_read") return readCall(m, bag, signal)
      if (name === "computer_write") return writeCall(m, bag, signal)
      if (name.startsWith("desktop_"))
        return withDriver((d) =>
          desktopCall(d, m, name.slice("desktop_".length), bag, deadlineFor(CALL_TIMEOUT_MS, signal)),
        )
      if (name.startsWith("browser_"))
        return withDriver((d) => browserCall(d, name, bag, deadlineFor(CALL_TIMEOUT_MS, signal)))
      if (TERMINAL_TOOLS.has(name))
        return withTerminals((manager) => {
          if (name === "terminal_open") return terminalOpen(manager, m, bag)
          if (name === "terminal_send") return terminalSend(manager, m, bag, signal)
          if (name === "terminal_read") return terminalRead(manager, bag)
          if (name === "terminal_wait") return terminalWait(manager, bag, signal)
          if (name === "terminal_list") return terminalList(manager, m)
          return terminalClose(manager, m, bag)
        })
      return text(`there is no tool called ${name}`, true)
    },
    async stop(): Promise<void> {
      if (owned) driver?.close()
      if (!options.terminals) terminals?.closeAll()
      terminals = options.terminals
      driver = options.driver ?? null
      desktop = []
      owned = false
      machine = undefined
    },
  }
}
