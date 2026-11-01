import { Type } from "@earendil-works/pi-ai"
import type { ModelRef, ToolExecutionApi } from "@earendil-works/pi-durable"
import type { DesktopTool, DriverCall } from "@kiko/computer/driver"
import type { FailCode } from "@kiko/computer/wire"
import { filesOf } from "../../files/room-fs"
import { encodeBase64 } from "../../lib/base64"
import { count } from "../../lib/dev-guard"
import type { ComputerPort } from "./port"
import type { ComputerCallOutcome, ComputerSummary } from "./types"

export const CALL_DEADLINE_MS = 60_000
const DRIVER_DEADLINE_MS = 30_000
export const MAX_OUTPUT_CHARS = 12_000
export const SCREEN_MAX_WIDTH = 960

export type ComputerToolDeps = {
  port: () => ComputerPort
  acceptsImages: (model: ModelRef | undefined) => boolean
  desktop: readonly DesktopTool[]
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
  `${pc.name} is not running the kiko app yet, so it cannot work in the background.`

export function failText(code: FailCode, message: string, pc: ComputerSummary): string {
  const reason = message.trim()
  const detail = reason ? ` (${reason})` : ""
  switch (code) {
    case "denied":
      return `The owner's policy on ${pc.name} blocks this.${detail}`
    case "busy":
      return pc.holder === "human" ? `${paused(pc)}${detail}` : reason || `${pc.name} is busy; try again shortly.`
    case "stale":
      return "Those ids are from an old view. Look at the window again."
    case "timeout":
      return `${pc.name} did not answer in time, so it may still be running that. look at the window to see the result.${detail}`
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
      return "that id is from an old view; read the page again"
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

export function seeFailure(outcome: { code: FailCode; message: string }, pc: ComputerSummary): string {
  return failText(outcome.code, outcome.message, pc)
}

export const PC = Type.Optional(
  Type.String({
    description:
      "the computer's name or id. computer_list shows every computer, what it can do and whether it is online. leave it out when the owner has one computer",
  }),
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

export function baseReady(deps: ComputerToolDeps) {
  return async (which?: string): Promise<Ready> => {
    const pc = await deps.port().resolve(which)
    if (!pc.online) return { ok: true, pc }
    if (pc.holder === "human") return { ok: false, result: text(paused(pc)) }
    return { ok: true, pc }
  }
}

export async function driverCall(
  deps: ComputerToolDeps,
  pc: ComputerSummary,
  call: DriverCall,
  deadlineMs = DRIVER_DEADLINE_MS,
): Promise<ComputerCallOutcome> {
  return deps.port().call(pc.id, "driver", call, deadlineMs)
}

export type ImageData = { mime: string; data: string | Uint8Array }

const decodeBase64 = (data: string): Uint8Array => Uint8Array.from(atob(data), (c) => c.charCodeAt(0))

const asBase64 = (data: string | Uint8Array): string => (typeof data === "string" ? data : encodeBase64(data))

const asBytes = (data: string | Uint8Array): Uint8Array => (typeof data === "string" ? decodeBase64(data) : data)

const extensionOf = (mime: string) => (mime === "image/png" ? "png" : "jpg")

async function saveScreenshot(api: Pick<ToolExecutionApi, "env">, image: ImageData): Promise<string | null> {
  const saved = `/computer-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}.${extensionOf(image.mime)}`
  const out = await filesOf(api).write(saved, asBytes(image.data), image.mime)
  return out.ok ? saved : null
}

export function imagesResult(
  api: Pick<ToolExecutionApi, "env">,
  images: readonly ImageData[],
  sees: boolean,
  body: string,
  isError = false,
): Promise<ComputerResult> {
  if (images.length === 0) return Promise.resolve(text(body, isError))
  if (sees)
    return Promise.resolve({
      output: [
        { type: "text", text: body },
        ...images.map((image) => ({ type: "image" as const, data: asBase64(image.data), mimeType: image.mime })),
      ],
      isError,
    })
  return Promise.all(images.map((image) => saveScreenshot(api, image))).then((saved) => {
    const paths = saved.filter((path): path is string => path !== null)
    if (paths.length === 0)
      return text(`${body}\n\nthe screenshots could not be saved, and your model cannot see images.`, true)
    const links = paths.map((path) => `![what it shows](${path})`).join(" ")
    return text(`${body}\n\nsaved to ${paths.join(", ")}. share it in your reply as ${links}`, isError)
  })
}

export function imageResult(
  api: Pick<ToolExecutionApi, "env">,
  image: ImageData | undefined,
  sees: boolean,
  body: string,
  isError = false,
): Promise<ComputerResult> {
  return imagesResult(api, image ? [image] : [], sees, body, isError)
}

export function imageOf(value: unknown): ImageData | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const record = value as Record<string, unknown>
  const mime = typeof record.mime === "string" ? record.mime : record.mimeType
  if (typeof mime !== "string") return undefined
  if (typeof record.data === "string" || record.data instanceof Uint8Array) return { mime, data: record.data }
  return undefined
}
