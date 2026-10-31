import type { ComputerSummary } from "@kiko/protocol"
import { timeAgo } from "../../lib/time-ago"

type OfflineNotice = { title: string; detail: string; fix: string }

const UPDATE = "Update kiko on this computer, then open the app again."
const START = "Start kiko on this computer."
const NETWORK = "Check that this computer is awake and connected to the network."

export function offlineNotice(computer: ComputerSummary, now: number): OfflineNotice {
  const seen =
    computer.lastSeenAt === undefined
      ? "it has not connected since it was paired"
      : `last seen ${timeAgo(now - computer.lastSeenAt)}`
  const reason = computer.lastCloseReason
  return {
    title: `${computer.name} is offline`,
    detail: reason ? `${seen} — ${reason}` : seen,
    fix: fixFor(reason),
  }
}

function fixFor(reason: string | undefined): string {
  if (reason === undefined) return START
  if (/protocol version/i.test(reason)) return UPDATE
  if (/network/i.test(reason)) return NETWORK
  return START
}
