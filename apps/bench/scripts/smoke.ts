import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { AgentBrowserContender } from "../src/contenders/agent-browser"
import { AgentDesktopContender } from "../src/contenders/agent-desktop"
import { CuaDriverContender } from "../src/contenders/cua-driver"
import type { Condition, Contender, Machine } from "../src/types"
import { prepareFixture, type Fixture } from "./fixture"
import { focusApp, focusWindow, frontmost, waitForFrontmost } from "./focus"
import { LocalMachine } from "./local-machine"

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
const DISCOVERY_TIMEOUT_MS = 30_000
const DISCOVERY_PAUSE_MS = 500
const CALL_TIMEOUT_MS = 120_000

interface Outcome {
  readonly ok: boolean
  readonly detail: string
  readonly focusBefore?: string
  readonly focusAfter?: string
}

interface ConditionResult {
  readonly version: string
  readonly tools: number
  readonly outcome: Outcome
  readonly focusBefore: string
  readonly focusAfter: string
}

interface Row {
  readonly contender: string
  readonly os: string
  readonly version: string
  readonly installs: string
  readonly toolsListed: string
  readonly foregroundAction: string
  readonly backgroundAction: string
  readonly focusKept: string
  readonly focusBefore: string
  readonly focusAfter: string
  readonly tools: number
  readonly detail: string
}

interface Options {
  readonly contender: string
  readonly out: string
  readonly typed: string
}

interface CuaWindow {
  readonly pid: number
  readonly id: number
  readonly title: string
}

interface DesktopWindow {
  readonly id: string
  readonly app: string
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
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

function createContender(name: string): Contender {
  if (name === "cua-driver") return new CuaDriverContender()
  if (name === "agent-desktop") return new AgentDesktopContender()
  if (name === "agent-browser") return new AgentBrowserContender()
  throw new Error(`unknown contender ${name}`)
}

function parseArgs(argv: readonly string[]): Options {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (key?.startsWith("--") && value !== undefined) values.set(key.slice(2), value)
  }
  const contender = values.get("contender")
  const out = values.get("out")
  const typed = values.get("typed")
  if (!contender || !out || !typed) throw new Error("usage: --contender <name> --out <path> --typed <text>")
  return { contender, out, typed }
}

function cuaWindows(text: string): CuaWindow[] {
  const parsed = parseJson(text)
  const records = Array.isArray(parsed)
    ? parsed
    : Array.isArray(asRecord(parsed).windows)
      ? asRecord(parsed).windows
      : []
  if (Array.isArray(records) && records.length > 0) {
    return records.flatMap((candidate) => {
      const window = asRecord(candidate)
      const id = Number(window.window_id)
      const pid = Number(window.pid)
      if (!Number.isFinite(id) || !Number.isFinite(pid)) return []
      return [{ pid, id, title: String(window.title ?? "") }]
    })
  }
  const windows: CuaWindow[] = []
  for (const line of text.split("\n")) {
    const id = line.match(/window_id[=:]\s*(\d+)/)?.[1]
    const pid = line.match(/pid[=:]\s*(\d+)/)?.[1] ?? line.match(/\(pid (\d+)\)/)?.[1]
    const title = line.match(/"([^"]*)"/)?.[1]
    if (!id || !pid || title === undefined) continue
    windows.push({ pid: Number(pid), id: Number(id), title })
  }
  return windows
}

async function findCuaWindow(c: Contender, f: Fixture, signal: AbortSignal): Promise<CuaWindow | undefined> {
  const deadline = Date.now() + DISCOVERY_TIMEOUT_MS
  for (;;) {
    const listed = await c.call("list_windows", {}, signal)
    const found = cuaWindows(listed.text).find((window) => window.title.includes(f.title))
    if (found) return found
    if (Date.now() >= deadline) return undefined
    await pause(DISCOVERY_PAUSE_MS)
  }
}

function findCuaToken(text: string): string | undefined {
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

async function cuaAction(c: Contender, f: Fixture, typed: string): Promise<Outcome> {
  const signal = AbortSignal.timeout(CALL_TIMEOUT_MS)
  const window = await findCuaWindow(c, f, signal)
  if (!window) return { ok: false, detail: "fixture window not listed" }
  const state = await c.call(
    "get_window_state",
    { pid: window.pid, window_id: window.id, include_screenshot: false },
    signal,
  )
  const token = findCuaToken(state.text)
  if (!token) return { ok: false, detail: `no text field in window state: ${state.text.slice(0, 400)}` }
  const target = { kind: "window", pid: window.pid, window_id: window.id }
  const inserted = await c.call("type_text", { target, element_token: token, text: typed }, signal)
  if (inserted.isError) return { ok: false, detail: `type_text failed: ${inserted.text.slice(0, 400)}` }
  const read = await c.call(
    "get_window_state",
    { pid: window.pid, window_id: window.id, query: typed, include_screenshot: false },
    signal,
  )
  if (!read.text.includes(typed)) return { ok: false, detail: `read back missing ${typed}: ${read.text.slice(0, 400)}` }
  return { ok: true, detail: `typed into ${token}` }
}

async function findDesktopWindow(c: Contender, f: Fixture, signal: AbortSignal): Promise<DesktopWindow | undefined> {
  const deadline = Date.now() + DISCOVERY_TIMEOUT_MS
  for (;;) {
    const listed = await c.call("list_windows", {}, signal)
    const parsed = parseJson(listed.text)
    const data = asRecord(parsed)
    const windows = Array.isArray(parsed) ? parsed : Array.isArray(data.windows) ? data.windows : []
    for (const candidate of windows) {
      const window = asRecord(candidate)
      if (!String(window.title ?? "").includes(f.title)) continue
      const id = window.id ?? window.window_id
      if (typeof id !== "string") continue
      const app = window.app_name ?? window.app ?? window.application ?? f.app
      return { id, app: typeof app === "string" ? app : f.app }
    }
    if (Date.now() >= deadline) return undefined
    await pause(DISCOVERY_PAUSE_MS)
  }
}

function findDesktopRef(tree: unknown, entryName: string): string | undefined {
  const queue: unknown[] = [tree]
  while (queue.length > 0) {
    const node = asRecord(queue.shift())
    const role = String(node.role ?? "").toLowerCase()
    const name = String(node.name ?? "").toLowerCase()
    const ref = node.ref_id
    if (typeof ref === "string" && TEXT_ROLES.has(role) && (!entryName || name.includes(entryName.toLowerCase()))) {
      return ref
    }
    const children = Array.isArray(node.children) ? node.children : []
    queue.push(...children)
  }
  return undefined
}

async function desktopAction(c: Contender, f: Fixture, typed: string): Promise<Outcome> {
  const signal = AbortSignal.timeout(CALL_TIMEOUT_MS)
  const window = await findDesktopWindow(c, f, signal)
  if (!window) return { ok: false, detail: "fixture window not listed" }
  const scope = { app: window.app, window_id: window.id, interactive: true }
  const snapshot = await c.call("snapshot", scope, signal)
  const data = asRecord(parseJson(snapshot.text))
  const ref = findDesktopRef(data.tree, f.entryName)
  if (!ref) return { ok: false, detail: `no text field in snapshot: ${snapshot.text.slice(0, 400)}` }
  const inserted = await c.call("type", { ref, text: typed }, signal)
  if (inserted.isError) return { ok: false, detail: `type failed: ${inserted.text.slice(0, 400)}` }
  const after = await c.call("snapshot", scope, signal)
  if (!after.text.includes(typed))
    return { ok: false, detail: `read back missing ${typed}: ${after.text.slice(0, 400)}` }
  return { ok: true, detail: `typed into ${ref}` }
}

async function browserAction(
  m: Machine,
  c: Contender,
  f: Fixture,
  typed: string,
  condition: Condition,
): Promise<Outcome> {
  const signal = AbortSignal.timeout(CALL_TIMEOUT_MS)
  const opened = await c.call("agent_browser_open", { url: f.browserUrl, headed: condition === "foreground" }, signal)
  if (opened.isError) return { ok: false, detail: `open failed: ${opened.text.slice(0, 400)}` }
  if (condition === "foreground") {
    if (m.os === "macos") {
      await focusApp(m, "Google Chrome")
      await waitForFrontmost(m, "Google Chrome", 10_000)
    } else {
      await focusWindow(m, f.browserTitle)
      await waitForFrontmost(m, f.browserTitle, 10_000)
    }
  }
  const before = await frontmost(m)
  const inserted = await c.call("agent_browser_type", { selector: "#field", text: typed }, signal)
  const read = await c.call("agent_browser_get_text", { selector: "#out" }, signal)
  const after = await frontmost(m)
  await c.call("agent_browser_close", {}, signal)
  if (inserted.isError || read.isError)
    return {
      ok: false,
      detail: `type/read failed: ${inserted.text} ${read.text}`,
      focusBefore: before,
      focusAfter: after,
    }
  if (!read.text.includes(typed))
    return {
      ok: false,
      detail: `read back missing ${typed}: ${read.text.slice(0, 400)}`,
      focusBefore: before,
      focusAfter: after,
    }
  return {
    ok: true,
    detail: `typed into #field (${condition === "foreground" ? "headed" : "headless"})`,
    focusBefore: before,
    focusAfter: after,
  }
}

async function focusFor(m: Machine, f: Fixture, condition: Condition): Promise<void> {
  const foreground = condition === "foreground"
  if (m.os === "macos") {
    await focusApp(m, foreground ? f.app : "Finder")
    return
  }
  await focusWindow(m, foreground ? f.title : f.decoyTitle)
}

function expectedFrontmost(m: Machine, f: Fixture, condition: Condition): string {
  if (condition === "background") return f.decoyTitle
  return m.os === "macos" ? f.app : f.title
}

async function runCondition(
  m: Machine,
  name: string,
  condition: Condition,
  f: Fixture,
  typed: string,
): Promise<ConditionResult> {
  const contender = createContender(name)
  await contender.start(m, condition)
  try {
    const tools = contender.tools().length
    const version = contender.version
    if (name === "agent-browser") {
      if (condition === "background") await focusFor(m, f, condition)
      const outcome = await browserAction(m, contender, f, typed, condition)
      return {
        version,
        tools,
        outcome,
        focusBefore: outcome.focusBefore ?? "",
        focusAfter: outcome.focusAfter ?? "",
      }
    }
    await focusFor(m, f, condition)
    await waitForFrontmost(m, expectedFrontmost(m, f, condition))
    const before = await frontmost(m)
    const outcome =
      name === "cua-driver" ? await cuaAction(contender, f, typed) : await desktopAction(contender, f, typed)
    const after = await frontmost(m)
    return { version, tools, outcome, focusBefore: before, focusAfter: after }
  } finally {
    await contender.stop()
  }
}

function cell(pass: boolean): string {
  return pass ? "pass" : "fail"
}

function buildRow(m: Machine, name: string, f: Fixture, foreground: ConditionResult, background: ConditionResult): Row {
  const fixtureInFront =
    m.os === "macos" ? background.focusBefore.includes(f.app) : background.focusBefore.includes(f.title)
  const focusKept = background.focusBefore !== "" && background.focusBefore === background.focusAfter && !fixtureInFront
  return {
    contender: name,
    os: m.id,
    version: foreground.version,
    installs: cell(foreground.version.length > 0),
    toolsListed: cell(foreground.tools > 0),
    foregroundAction: cell(foreground.outcome.ok),
    backgroundAction: cell(background.outcome.ok),
    focusKept: cell(focusKept),
    focusBefore: background.focusBefore,
    focusAfter: background.focusAfter,
    tools: foreground.tools,
    detail: `foreground: ${foreground.outcome.detail}; background: ${background.outcome.detail}`,
  }
}

async function writeRow(out: string, row: Row): Promise<void> {
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, `${JSON.stringify(row, null, 2)}\n`)
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const machine = await LocalMachine.create(`gha-${process.platform}`)
  let fixture: Fixture | undefined
  try {
    fixture = await prepareFixture(machine)
    const foreground = await runCondition(machine, options.contender, "foreground", fixture, options.typed)
    const background = await runCondition(machine, options.contender, "background", fixture, options.typed)
    const row = buildRow(machine, options.contender, fixture, foreground, background)
    await writeRow(options.out, row)
    console.log(JSON.stringify(row))
  } catch (error) {
    const row: Row = {
      contender: options.contender,
      os: machine.id,
      version: "",
      installs: "fail",
      toolsListed: "fail",
      foregroundAction: "fail",
      backgroundAction: "fail",
      focusKept: "fail",
      focusBefore: "",
      focusAfter: "",
      tools: 0,
      detail: error instanceof Error ? error.message : String(error),
    }
    await writeRow(options.out, row)
    console.log(JSON.stringify(row))
  } finally {
    await fixture?.stop()
    await machine.cleanup()
  }
}

await main()
