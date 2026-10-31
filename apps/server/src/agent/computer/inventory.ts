import { ago } from "../../lib/ago"
import type { ComputerSummary } from "./types"

const MAX_CONTEXT = 8

const state = (pc: ComputerSummary): string => (pc.online ? "online" : "offline")

function capabilities(pc: ComputerSummary): string[] {
  const caps = pc.caps
  const labels: string[] = []
  if (caps.shell) labels.push("shell")
  if (caps.files) labels.push("files")
  if (caps.terminal) labels.push("terminal")
  if (caps.desktop) labels.push("desktop")
  if (caps.browser || pc.browsers.length > 0) labels.push("browser")
  return labels
}

function contextEntry(pc: ComputerSummary): string {
  return `${pc.name} (${[pc.os, state(pc), ...capabilities(pc)].join(", ")})`
}

export function computersContext(all: readonly ComputerSummary[]): string | undefined {
  if (all.length === 0) return undefined
  const shown = all.slice(0, MAX_CONTEXT).map(contextEntry)
  const hidden = all.length - shown.length
  const more = hidden > 0 ? `, and ${hidden} more, shown by computer_list` : ""
  return `computers: ${shown.join(", ")}${more}.`
}

function detail(pc: ComputerSummary, now: number): string {
  const facts = [pc.os, state(pc), ...capabilities(pc)]
  const sentences = [`${pc.name} (id ${pc.id}): ${facts.join(", ")}.`]
  sentences.push(pc.version ? `daemon ${pc.version}.` : "daemon version unknown.")
  if (pc.holder === "human") sentences.push("the owner has control.")
  if (pc.lastSeenAt !== undefined) sentences.push(`last seen ${ago(now - pc.lastSeenAt)}.`)
  if (pc.lastCloseReason) sentences.push(`the last connection ended because ${pc.lastCloseReason}.`)
  if (pc.browsers.length > 0)
    sentences.push(`browsers: ${pc.browsers.map((browser) => `${browser.name} ${browser.state}`).join(", ")}.`)
  if (pc.note) sentences.push(`note: ${pc.note}`)
  return sentences.join(" ")
}

export function computerListText(all: readonly ComputerSummary[], now = Date.now()): string {
  if (all.length === 0) return "no computers are paired with kiko: the owner pairs one in settings, computers."
  return [`computers (${all.length}):`, ...all.map((pc) => detail(pc, now))].join("\n")
}
