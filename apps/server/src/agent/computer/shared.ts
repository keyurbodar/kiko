import { Type } from "@earendil-works/pi-ai"
import type { ModelRef, ToolExecutionApi } from "@earendil-works/pi-durable"
import type { DriverCall } from "@kiko/computer/driver"
import type { FailCode } from "@kiko/computer/wire"
import { filesOf } from "../../files/room-fs"
import { count } from "../../lib/dev-guard"
import type { ComputerPort } from "./port"
import type { ComputerCallOutcome, ComputerSummary } from "./types"

export const CALL_DEADLINE_MS = 60_000
const DRIVER_DEADLINE_MS = 30_000
const MAX_OUTPUT_CHARS = 12_000
export const MAX_STEPS = 10
export const SCREEN_MAX_WIDTH = 1280

const BACKGROUND_UNAVAILABLE = "background_unavailable:"

export type ComputerToolDeps = {
  port: () => ComputerPort
  acceptsImages: (model: ModelRef | undefined) => boolean
}

type Part = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }

export type ComputerResult = { output: Part[]; isError?: boolean }

export type Ready = { ok: true; pc: ComputerSummary } | { ok: false; result: ComputerResult }

export const text = (value: string, isError = false): ComputerResult => ({
  output: [{ type: "text", text: value }],
  isError,
})

export const cut = (value: string): string =>
  value.length > MAX_OUTPUT_CHARS ? `${value.slice(0, MAX_OUTPUT_CHARS - 1)}…` : value

export const tail = (value: string): string =>
  value.length > MAX_OUTPUT_CHARS ? `…${value.slice(value.length - MAX_OUTPUT_CHARS + 1)}` : value

export const paused = (pc: ComputerSummary) =>
  `The human has control of ${pc.name}, so your computer tools are paused and nothing ran. When they press I'm done you are told to carry on.`

export const offline = (pc: ComputerSummary) => `${pc.name} is offline: its daemon is not connected.`

export const notRunning = (pc: ComputerSummary) =>
  `${pc.name} is not running the kiko app yet, so it cannot work in the background. use computer_look and computer_act only if the owner agrees to share their screen.`

const screenDenied = (pc: ComputerSummary): string =>
  pc.os === "macos"
    ? "macOS has not allowed kiko-computer-host to record the screen. On the Mac, open System Settings > Privacy & Security > Screen Recording and turn on kiko-computer-host."
    : `${pc.name} has not allowed kiko-computer-host to record its screen.`

const inputDenied = (pc: ComputerSummary): string =>
  pc.os === "macos"
    ? "macOS has not allowed kiko-computer-host to control this Mac. On the Mac, open System Settings > Privacy & Security > Accessibility and turn on kiko-computer-host."
    : `${pc.name} has not allowed kiko-computer-host to control it.`

const BLOCKED: Readonly<Record<"shell" | "read" | "write" | "look" | "act", string>> = {
  shell: "running commands",
  read: "reading files",
  write: "writing files",
  look: "seeing the desktop",
  act: "using the desktop",
}

const CAPS: Readonly<Record<keyof typeof BLOCKED, keyof ComputerSummary["caps"]>> = {
  shell: "shell",
  read: "files",
  write: "files",
  look: "desktop",
  act: "desktop",
}

export function failText(code: FailCode, message: string, pc: ComputerSummary): string {
  const reason = message.trim()
  const detail = reason ? ` (${reason})` : ""
  switch (code) {
    case "denied":
      return `The owner's policy on ${pc.name} blocks this.${detail}`
    case "busy":
      return pc.holder === "human" ? `${paused(pc)}${detail}` : reason || `${pc.name} is busy; try again shortly.`
    case "stale":
      return "Those ids are from an old view. Call computer_look again."
    case "timeout":
      return `${pc.name} did not answer in time, so it may still be running that. call computer_look to see the screen.${detail}`
    case "unsupported":
      return `${pc.name} cannot do this: ${reason || "its daemon does not support that op."}`
    case "cancelled":
      return `the call to ${pc.name} was cancelled.${detail}`
    default:
      return reason || `${pc.name} failed that call.`
  }
}

export function stepFailure(code: FailCode, message: string, pc: ComputerSummary): string {
  const reason = message.trim()
  switch (code) {
    case "stale":
      return "that [ref] is from an old view; call computer_see again"
    case "busy":
      return pc.holder === "human" ? "the owner has control right now" : reason || "the computer is busy"
    case "timeout":
      return "it did not answer in time"
    case "cancelled":
      return "the call was cancelled"
    case "denied":
      return reason || "the owner's policy blocks this"
    case "unsupported":
      return reason || "the kiko app cannot do that in the background"
    default:
      return reason || "it failed"
  }
}

export function isBackgroundUnavailable(outcome: { code: FailCode; message: string }): boolean {
  return outcome.code === "unsupported" && outcome.message.startsWith(BACKGROUND_UNAVAILABLE)
}

export function backgroundReason(message: string): string {
  return message.slice(BACKGROUND_UNAVAILABLE.length)
}

export function backgroundUnavailable(message: string): string {
  const reason = message.trim().replace(/[.!?]$/, "")
  return `${reason}. this needs the owner's screen: ask the owner first, then call computer_use with on_screen true, or computer_act`
}

export function seeFailure(outcome: { code: FailCode; message: string }, pc: ComputerSummary): string {
  return isBackgroundUnavailable(outcome)
    ? backgroundUnavailable(backgroundReason(outcome.message))
    : failText(outcome.code, outcome.message, pc)
}

export const PC = Type.Optional(
  Type.String({ description: "the computer's name or id. leave it out when the owner has one computer" }),
)

export function run(tool: string, call: () => Promise<ComputerResult>): Promise<ComputerResult> {
  const started = performance.now()
  return call()
    .catch((e: unknown) => text(e instanceof Error ? e.message : String(e), true))
    .finally(() => {
      count(`computer.${tool}.ms`, Math.round(performance.now() - started))
      count(`computer.${tool}.calls`)
    })
}

export function readyFor(deps: ComputerToolDeps) {
  return async (which: string | undefined, op: keyof typeof CAPS): Promise<Ready> => {
    const pc = await deps.port().resolve(which)
    if ((await deps.port().holder(pc.id)) === "human") return { ok: false, result: text(paused(pc)) }
    if (!pc.online) return { ok: false, result: text(offline(pc), true) }
    if (!pc.caps[CAPS[op]])
      return {
        ok: false,
        result: text(`${pc.name} blocks ${BLOCKED[op]} in its policy, so this cannot run there.`, true),
      }
    if ((op === "look" || op === "act") && pc.access?.screen === false)
      return { ok: false, result: text(screenDenied(pc), true) }
    if (op === "act" && pc.access?.input === false) return { ok: false, result: text(inputDenied(pc), true) }
    return { ok: true, pc }
  }
}

export function baseReady(deps: ComputerToolDeps) {
  return async (which?: string): Promise<Ready> => {
    const pc = await deps.port().resolve(which)
    if ((await deps.port().holder(pc.id)) === "human") return { ok: false, result: text(paused(pc)) }
    if (!pc.online) return { ok: false, result: text(offline(pc), true) }
    return { ok: true, pc }
  }
}

export function backgroundReady(deps: ComputerToolDeps) {
  const base = baseReady(deps)
  return async (which?: string): Promise<Ready> => {
    const target = await base(which)
    if (!target.ok) return target
    if (!target.pc.background) return { ok: false, result: text(notRunning(target.pc), true) }
    return target
  }
}

export async function driverCall(
  deps: ComputerToolDeps,
  pc: ComputerSummary,
  call: DriverCall,
): Promise<ComputerCallOutcome> {
  return deps.port().call(pc.id, "driver", call, DRIVER_DEADLINE_MS)
}

const decodeBase64 = (data: string): Uint8Array => Uint8Array.from(atob(data), (c) => c.charCodeAt(0))

const extensionOf = (mime: string) => (mime === "image/png" ? "png" : "jpg")

async function saveScreenshot(
  api: Pick<ToolExecutionApi, "env">,
  image: { mime: string; data: string },
): Promise<string | null> {
  const saved = `/computer-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}.${extensionOf(image.mime)}`
  const out = await filesOf(api).write(saved, decodeBase64(image.data), image.mime)
  return out.ok ? saved : null
}

export function imageResult(
  api: Pick<ToolExecutionApi, "env">,
  image: { mime: string; data: string } | undefined,
  sees: boolean,
  body: string,
): Promise<ComputerResult> {
  if (!image) return Promise.resolve(text(body))
  if (sees)
    return Promise.resolve({
      output: [
        { type: "text", text: body },
        { type: "image", data: image.data, mimeType: image.mime },
      ],
    })
  return saveScreenshot(api, image).then((saved) =>
    saved
      ? text(`${body}\n\nsaved to ${saved}. share it in your reply as ![what it shows](${saved})`)
      : text(`${body}\n\nthe screenshot could not be saved, and your model cannot see images.`, true),
  )
}
