import { Type } from "@earendil-works/pi-ai"
import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable"
import type { Value } from "@kiko/computer/wire"
import {
  baseReady,
  CALL_DEADLINE_MS,
  failText,
  MAX_OUTPUT_CHARS,
  PC,
  run,
  text,
  type ComputerToolDeps,
  type Ready,
} from "./shared"
import type { ComputerSummary } from "./types"

const WAIT_DEFAULT_MS = 30_000
const WAIT_MAX_MS = 120_000
const WAIT_SLACK_MS = 10_000
const MAX_DEADLINE_MS = 590_000
const MAX_KEYS = 20

const OPEN_DESCRIPTION =
  "open a terminal on the computer: a real shell that stays alive between your turns, so you can start a long job, a REPL, or a full-screen app and come back to it. returns an id. cwd is where it starts, default the owner's home folder. cols and rows are the text size, default 120x30. shell is the program to run, default the owner's login shell. open a second terminal for a second job. for one command that finishes, computer_shell is simpler."

const SEND_DESCRIPTION =
  'type into a terminal from terminal_open. text is typed exactly as written and does not press enter. keys presses named keys in order, such as ["enter"], ["ctrl+c"], ["up"], ["tab"], ["esc"], ["ctrl+d"]; use ctrl. give both to type a command and run it in one call. add until to send and wait in one call: the reply comes back as soon as that output appears, with the output up to it, or says it timed out. until is text, or a regular expression with regex true; timeoutMs defaults 30000 and is at most 120000. without until it does not return the screen: call terminal_wait to wait, or terminal_read to look.'

const READ_DESCRIPTION =
  "read a terminal as text. mode screen is the current visible screen, which is what a full-screen app such as vim, less or top shows. mode tail is the end of the output history, which is what a plain command printed; escape codes are removed. lines is how many lines of the tail to return, default 200, at most 2000. the reply says when older output was cut."

const WAIT_DESCRIPTION =
  "wait until a terminal prints something, without polling. until is the text to look for or, with regex true, a regular expression. it returns as soon as that appears, or says it timed out, or that the terminal exited. timeoutMs defaults 30000 and is at most 120000. use it after terminal_send to wait for a prompt or a command to finish instead of reading in a loop. the reply includes the end of the output, with escape codes removed."

const LIST_DESCRIPTION =
  "list the terminal sessions open on the computer with their ids, names, folders, sizes and whether they are still running. use it when you do not remember an id, or to see what is still open before you finish."

const CLOSE_DESCRIPTION =
  "close a terminal and stop whatever runs in it. use it when a job is finished so it stops using the owner's machine. a terminal nobody touches closes itself after 30 minutes idle."

const Mode = Type.Union([Type.Literal("screen"), Type.Literal("tail")])

const statusOf = (value: { status: "running" | "exited"; exitCode: number | null }): string =>
  value.status === "running" ? "running" : `exited with code ${value.exitCode === null ? "unknown" : value.exitCode}`

const headOf = (pc: ComputerSummary, value: Value<"terminal_read">): string =>
  `${value.id} on ${pc.name}, ${value.cols}x${value.rows}, ${statusOf(value)}`

function bodyOf(value: string, truncated: boolean): string {
  const notes: string[] = []
  if (truncated) notes.push("older output was cut")
  if (value.length > MAX_OUTPUT_CHARS) notes.push(`only the last ${MAX_OUTPUT_CHARS} characters are shown`)
  const shown = value.length > MAX_OUTPUT_CHARS ? `…${value.slice(value.length - MAX_OUTPUT_CHARS + 1)}` : value
  const body = shown.trim() ? shown : "(no output)"
  return notes.length > 0 ? `${notes.join("; ")}\n\n${body}` : body
}

type SendArgs = { id: string; text?: string; keys?: readonly string[]; until?: string; regex?: boolean }

function sendBody(args: SendArgs, until: string | undefined, timeoutMs: number) {
  return {
    id: args.id,
    ...(args.text !== undefined ? { text: args.text } : {}),
    ...(args.keys ? { keys: args.keys } : {}),
    ...(until !== undefined ? { until, timeoutMs } : {}),
    ...(args.regex ? { regex: true } : {}),
  }
}

function sendText(
  args: SendArgs,
  pc: ComputerSummary,
  value: Value<"terminal_send">,
  until: string | undefined,
  timeoutMs: number,
): string {
  const sent = `sent ${value.bytes} bytes to ${args.id} on ${pc.name}`
  if (until === undefined)
    return `${sent}. call terminal_wait to wait for the output, or terminal_read to see the screen.`
  if (value.matched === undefined && value.timedOut === undefined && value.exited === undefined)
    return `${sent}. the app on ${pc.name} cannot wait yet: update it, or call terminal_wait to wait.`
  const head = value.matched
    ? `${sent} and found ${JSON.stringify(until)}.`
    : value.exited
      ? `${sent}; it exited while waiting for ${JSON.stringify(until)}.`
      : `${sent}; waited ${Math.round(timeoutMs / 1000)} s and did not see ${JSON.stringify(until)}.`
  return `${head}\n\n${bodyOf(value.text ?? "", false)}`
}

export function terminalTools(deps: ComputerToolDeps): ToolRegistration[] {
  const ready = baseReady(deps)

  const target = async (which?: string): Promise<Ready> => {
    const found = await ready(which)
    if (!found.ok || !found.pc.online) return found
    if (found.pc.caps.terminal === undefined)
      return {
        ok: false,
        result: text(`${found.pc.name} runs a kiko app that cannot open terminals; update the app on it.`, true),
      }
    if (!found.pc.caps.terminal)
      return {
        ok: false,
        result: text(`${found.pc.name} blocks opening terminals in its policy, so this cannot run there.`, true),
      }
    return found
  }

  const open = defineTool({
    name: "terminal_open",
    description: OPEN_DESCRIPTION,
    parameters: Type.Object({
      pc: PC,
      cwd: Type.Optional(Type.String({ description: "the folder to start in, default the owner's home folder" })),
      shell: Type.Optional(Type.String({ description: "the shell program, default the owner's login shell" })),
      cols: Type.Optional(Type.Number({ description: "text columns, default 120, at most 500" })),
      rows: Type.Optional(Type.Number({ description: "text rows, default 30, at most 200" })),
      name: Type.Optional(Type.String({ description: "a short name to tell terminals apart" })),
    }),
    replay: "unsafe",
    execute: (args) =>
      run("terminal_open", async () => {
        const found = await target(args.pc)
        if (!found.ok) return found.result
        const pc = found.pc
        const body = {
          ...(args.cwd ? { cwd: args.cwd } : {}),
          ...(args.shell ? { shell: args.shell } : {}),
          ...(args.cols ? { cols: Math.round(args.cols) } : {}),
          ...(args.rows ? { rows: Math.round(args.rows) } : {}),
          ...(args.name ? { name: args.name } : {}),
        }
        const out = await deps.port().call(pc.id, "terminal_open", body, CALL_DEADLINE_MS)
        if (!out.ok) return text(failText(out.code, out.message, pc), true)
        const value = out.value as Value<"terminal_open">
        return text(
          `opened ${value.name} (${value.id}) running ${value.shell} in ${value.cwd}, ${value.cols}x${value.rows}. it stays open between your turns: type with terminal_send, then terminal_wait or terminal_read.`,
        )
      }),
  })

  const send = defineTool({
    name: "terminal_send",
    description: SEND_DESCRIPTION,
    parameters: Type.Object({
      pc: PC,
      id: Type.String({ description: "the terminal id from terminal_open or terminal_list" }),
      text: Type.Optional(Type.String({ description: "the text to type, without pressing enter" })),
      keys: Type.Optional(
        Type.Array(Type.String(), {
          minItems: 1,
          maxItems: MAX_KEYS,
          description: 'named keys to press in order, such as ["enter"], ["ctrl+c"], ["up"]',
        }),
      ),
      until: Type.Optional(
        Type.String({ description: "wait in the same call until this output appears, then return it" }),
      ),
      regex: Type.Optional(Type.Boolean({ description: "treat until as a regular expression, default false" })),
      timeoutMs: Type.Optional(
        Type.Number({ description: "how long to wait for until, default 30000, at most 120000" }),
      ),
    }),
    replay: "unsafe",
    execute: (args) =>
      run("terminal_send", async () => {
        const found = await target(args.pc)
        if (!found.ok) return found.result
        const pc = found.pc
        if (args.text === undefined && (args.keys ?? []).length === 0)
          return text("terminal_send needs text or keys.", true)
        const until = args.until?.trim()
        if (args.until !== undefined && !until) return text("until needs some text to look for.", true)
        const timeoutMs = Math.min(Math.max(Math.round(args.timeoutMs ?? WAIT_DEFAULT_MS), 1_000), WAIT_MAX_MS)
        const deadlineMs = until === undefined ? CALL_DEADLINE_MS : Math.min(timeoutMs + WAIT_SLACK_MS, MAX_DEADLINE_MS)
        const out = await deps.port().call(pc.id, "terminal_send", sendBody(args, until, timeoutMs), deadlineMs)
        if (!out.ok) return text(failText(out.code, out.message, pc), true)
        return text(sendText(args, pc, out.value as Value<"terminal_send">, until, timeoutMs))
      }),
  })

  const read = defineTool({
    name: "terminal_read",
    description: READ_DESCRIPTION,
    parameters: Type.Object({
      pc: PC,
      id: Type.String({ description: "the terminal id from terminal_open or terminal_list" }),
      mode: Mode,
      lines: Type.Optional(Type.Number({ description: "for mode tail: how many lines, default 200, at most 2000" })),
    }),
    replay: "safe",
    execute: (args) =>
      run("terminal_read", async () => {
        const found = await target(args.pc)
        if (!found.ok) return found.result
        const pc = found.pc
        const body = { id: args.id, mode: args.mode, ...(args.lines ? { lines: Math.round(args.lines) } : {}) }
        const out = await deps.port().call(pc.id, "terminal_read", body, CALL_DEADLINE_MS)
        if (!out.ok) return text(failText(out.code, out.message, pc), true)
        const value = out.value as Value<"terminal_read">
        return text(`${headOf(pc, value)}\n\n${bodyOf(value.text, value.truncated)}`)
      }),
  })

  const wait = defineTool({
    name: "terminal_wait",
    description: WAIT_DESCRIPTION,
    parameters: Type.Object({
      pc: PC,
      id: Type.String({ description: "the terminal id from terminal_open or terminal_list" }),
      until: Type.String({ description: "the text to look for" }),
      regex: Type.Optional(Type.Boolean({ description: "treat until as a regular expression, default false" })),
      timeoutMs: Type.Optional(Type.Number({ description: "how long to wait, default 30000, at most 120000" })),
    }),
    replay: "safe",
    execute: (args) =>
      run("terminal_wait", async () => {
        const found = await target(args.pc)
        if (!found.ok) return found.result
        const pc = found.pc
        if (!args.until.trim()) return text("terminal_wait needs some text to look for.", true)
        const timeoutMs = Math.min(Math.max(Math.round(args.timeoutMs ?? WAIT_DEFAULT_MS), 1_000), WAIT_MAX_MS)
        const body = {
          id: args.id,
          until: args.until,
          ...(args.regex ? { regex: true } : {}),
          timeoutMs,
        }
        const out = await deps
          .port()
          .call(pc.id, "terminal_wait", body, Math.min(timeoutMs + WAIT_SLACK_MS, MAX_DEADLINE_MS))
        if (!out.ok) return text(failText(out.code, out.message, pc), true)
        const value = out.value as Value<"terminal_wait">
        const head = value.matched
          ? `found ${JSON.stringify(args.until)} in ${args.id} on ${pc.name}.`
          : value.exited
            ? `${args.id} on ${pc.name} exited while waiting for ${JSON.stringify(args.until)}.`
            : `waited ${Math.round(timeoutMs / 1000)} s and did not see ${JSON.stringify(args.until)} in ${args.id} on ${pc.name}.`
        return text(`${head}\n\n${bodyOf(value.text, false)}`)
      }),
  })

  const list = defineTool({
    name: "terminal_list",
    description: LIST_DESCRIPTION,
    parameters: Type.Object({ pc: PC }),
    replay: "safe",
    execute: (args) =>
      run("terminal_list", async () => {
        const found = await target(args.pc)
        if (!found.ok) return found.result
        const pc = found.pc
        const out = await deps.port().call(pc.id, "terminal_list", {}, CALL_DEADLINE_MS)
        if (!out.ok) return text(failText(out.code, out.message, pc), true)
        const value = out.value as Value<"terminal_list">
        if (value.terminals.length === 0)
          return text(`no terminal sessions are open on ${pc.name}. open one with terminal_open.`)
        const lines = value.terminals.map(
          (terminal) =>
            `${terminal.id} "${terminal.name}" ${terminal.cwd} ${terminal.cols}x${terminal.rows} ${statusOf(terminal)}`,
        )
        return text(`${value.terminals.length} terminal session(s) on ${pc.name}:\n${lines.join("\n")}`)
      }),
  })

  const close = defineTool({
    name: "terminal_close",
    description: CLOSE_DESCRIPTION,
    parameters: Type.Object({
      pc: PC,
      id: Type.String({ description: "the terminal id from terminal_open or terminal_list" }),
    }),
    replay: "unsafe",
    execute: (args) =>
      run("terminal_close", async () => {
        const found = await target(args.pc)
        if (!found.ok) return found.result
        const pc = found.pc
        const out = await deps.port().call(pc.id, "terminal_close", { id: args.id }, CALL_DEADLINE_MS)
        if (!out.ok) return text(failText(out.code, out.message, pc), true)
        return text(`closed ${args.id} on ${pc.name}.`)
      }),
  })

  return [open, send, read, wait, list, close]
}
