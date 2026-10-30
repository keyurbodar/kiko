import type { SettledAsyncResult } from "@kiko/client-runtime/state"
import type { ComputerSummary } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { failureMessage, owner, run } from "../state/runtime"
import { onUserSignal } from "../state/user"

const [list, setList] = createSignal<readonly ComputerSummary[]>([])
export const computers = list

export const computerById = (pcId: string): ComputerSummary | undefined => list().find((c) => c.id === pcId)

function patch(pcId: string, change: (computer: ComputerSummary) => ComputerSummary): void {
  setList((all) => all.map((c) => (c.id === pcId ? change(c) : c)))
}

export type Outcome = { ok: true } | { ok: false; error: string }

const outcome = (result: SettledAsyncResult<unknown, unknown>): Outcome =>
  result._tag === "Success" ? { ok: true } : { ok: false, error: failureMessage(result.cause, "Kiko did not answer.") }

const [viewing, setViewing] = createSignal<string | null>(null)
export const viewerFor = viewing
export const openViewer = (pcId: string) => setViewing(pcId)
export function closeViewer(): void {
  const pcId = viewing()
  if (pcId === null) return
  const pc = computerById(pcId)
  if (pc?.holder === "human" && pc.heldBy === "you") void release(pcId)
  setViewing(null)
}

async function refreshList(): Promise<void> {
  const result = await run(owner.commands.pcList, {})
  if (result._tag === "Success") setList(result.value)
}

let started = false
export function startComputers(): void {
  if (started) return
  started = true
  onUserSignal("pcState", (signal) => setList(signal.computers))
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshList()
  })
  window.addEventListener("online", () => void refreshList())
}

export async function takeOver(pcId: string): Promise<Outcome> {
  const previous = computerById(pcId)
  patch(pcId, (c) => ({ ...c, holder: "human", heldBy: "you" }))
  const result = outcome(await run(owner.commands.pcTake, { pcId }))
  if (!result.ok) {
    if (previous) patch(pcId, () => previous)
    return result
  }
  openViewer(pcId)
  return result
}

export async function release(pcId: string): Promise<Outcome> {
  const previous = computerById(pcId)
  patch(pcId, ({ agent: _agent, heldBy: _heldBy, ...c }) => ({ ...c, holder: "agent" }))
  const result = outcome(await run(owner.commands.pcRelease, { pcId }))
  if (!result.ok) {
    if (previous) patch(pcId, () => previous)
    return result
  }
  if (viewing() === pcId) closeViewer()
  return result
}

export async function renameComputer(pcId: string, name: string): Promise<Outcome> {
  const previous = computerById(pcId)?.name
  patch(pcId, (c) => ({ ...c, name }))
  const result = outcome(await run(owner.commands.pcRename, { pcId, name }))
  if (!result.ok && previous !== undefined) patch(pcId, (c) => ({ ...c, name: previous }))
  return result
}

export async function removeComputer(pcId: string): Promise<Outcome> {
  const previous = list()
  setList((all) => all.filter((c) => c.id !== pcId))
  const result = outcome(await run(owner.commands.pcRemove, { pcId }))
  if (!result.ok) setList((all) => (all.some((c) => c.id === pcId) ? all : previous))
  return result
}

export type PairCode = { code: string; url: string; expiresAt: number }

export async function requestPairCode(): Promise<PairCode | null> {
  const result = await run(owner.commands.pcPairCode, {})
  return result._tag === "Success" ? result.value : null
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
