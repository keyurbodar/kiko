import { readFileSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"
import type { DesktopInfo, DesktopTool, Page, PageAction, Tab } from "@kiko/computer/driver"
import type { Value } from "@kiko/computer/wire"
import { Deadline } from "@kiko/computer-daemon/src/deadline.ts"
import { startDriver, type Driver } from "@kiko/computer-daemon/src/driver.ts"
import { createLogger, failureMessage } from "@kiko/computer-daemon/src/log.ts"
import { read, shell, write } from "@kiko/computer-daemon/src/ops.ts"
import type { Policy } from "@kiko/computer-daemon/src/config.ts"
import type { Contender, Image, Machine, ToolResult, ToolSpec } from "../types"
import { KIKO_TOOLS } from "./kiko-schemas"

const SHELL_TIMEOUT_MS = 60_000
const CALL_TIMEOUT_MS = 60_000
const MAX_OUTPUT_CHARS = 12_000
const MAX_READ_BYTES = 64_000
const SCREEN_MAX_WIDTH = 960
const BROWSER_STEPS_MAX = 20

type Bag = Record<string, unknown>

const isBag = (value: unknown): value is Bag => typeof value === "object" && value !== null

const bagOf = (value: unknown): Bag => (isBag(value) ? value : {})

const stringOf = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)

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

export interface KikoOptions {
  readonly driver?: Driver
}

export function kikoContender(options: KikoOptions = {}): Contender {
  let machine: Machine | undefined
  let driver: Driver | null = options.driver ?? null
  let desktop: DesktopTool[] = []
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

  return {
    name: "kiko",
    version: kikoVersion(),
    tracks: ["terminal", "browser", "desktop", "mixed"],
    async start(m: Machine): Promise<void> {
      machine = m
      const path = process.env.KIKO_DRIVER
      if (!driver && path) {
        driver = startDriver({ path, log: createLogger("kiko-bench") })
        owned = true
      }
      desktop = driver ? await loadDesktopTools(driver) : []
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
      return text(`there is no tool called ${name}`, true)
    },
    async stop(): Promise<void> {
      if (owned) driver?.close()
      driver = options.driver ?? null
      desktop = []
      owned = false
      machine = undefined
    },
  }
}
