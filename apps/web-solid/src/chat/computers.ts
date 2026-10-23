import type { ClientToUser, ComputerSummary, UserToClient } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { userChannel } from "../sync/socket"

const ASK_TIMEOUT_MS = 15_000

const [list, setList] = createSignal<readonly ComputerSummary[]>([])
export const computers = list

const [viewing, setViewing] = createSignal<string | null>(null)
export const viewerFor = viewing
export const openViewer = (pcId: string) => setViewing(pcId)
export const closeViewer = () => setViewing(null)

let started = false
export function startComputers(): void {
  if (started) return
  started = true
  userChannel.on("pcState", (frame) => setList(frame.computers))
}

export const computerById = (pcId: string): ComputerSummary | undefined => list().find((c) => c.id === pcId)

function patch(pcId: string, change: (computer: ComputerSummary) => ComputerSummary): void {
  setList((all) => all.map((c) => (c.id === pcId ? change(c) : c)))
}

export function takeOver(pcId: string): void {
  patch(pcId, (c) => ({ ...c, holder: "human", heldBy: "you" }))
  userChannel.send({ t: "pc.take", pcId })
  openViewer(pcId)
}

export function release(pcId: string): void {
  patch(pcId, ({ agent: _agent, heldBy: _heldBy, ...c }) => ({ ...c, holder: "agent" }))
  userChannel.send({ t: "pc.release", pcId })
  if (viewing() === pcId) closeViewer()
}

type Reply = {
  "pc.result": Extract<UserToClient, { t: "pc.result" }>
  "pc.pairCode": Extract<UserToClient, { t: "pc.pairCode" }>
}

let n = 0
function ask<T extends keyof Reply>(reply: T, frame: (reqId: string) => ClientToUser): Promise<Reply[T] | null> {
  return new Promise((resolve) => {
    const reqId = `pc${++n}`
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = userChannel.on(reply, (frame) => {
      const got = frame as Reply[T]
      if (got.reqId !== reqId) return
      off()
      clearTimeout(timer)
      resolve(got)
    })
    timer = setTimeout(() => {
      off()
      resolve(null)
    }, ASK_TIMEOUT_MS)
    if (!userChannel.send(frame(reqId))) {
      off()
      clearTimeout(timer)
      resolve(null)
    }
  })
}

export type Outcome = { ok: true } | { ok: false; error: string }

const outcome = (result: Reply["pc.result"] | null): Outcome =>
  result?.ok ? { ok: true } : { ok: false, error: result?.error ?? "Kiko did not answer." }

export async function renameComputer(pcId: string, name: string): Promise<Outcome> {
  const result = outcome(await ask("pc.result", (reqId) => ({ t: "pc.rename", reqId, pcId, name })))
  if (result.ok) patch(pcId, (c) => ({ ...c, name }))
  return result
}

export async function removeComputer(pcId: string): Promise<Outcome> {
  const result = outcome(await ask("pc.result", (reqId) => ({ t: "pc.remove", reqId, pcId })))
  if (result.ok) setList((all) => all.filter((c) => c.id !== pcId))
  return result
}

export type PairCode = { code: string; url: string; expiresAt: number }

export async function requestPairCode(): Promise<PairCode | null> {
  const got = await ask("pc.pairCode", (reqId) => ({ t: "pc.pairCode", reqId }))
  return got ? { code: got.code, url: got.url, expiresAt: got.expiresAt } : null
}

export function watchTarget(roomId: string | null): string {
  const all = list()
  const pick =
    all.find((c) => c.holder === "human") ??
    all.find((c) => roomId !== null && c.agent?.roomId === roomId) ??
    all.find((c) => c.online) ??
    all[0]
  return pick?.id ?? ""
}
