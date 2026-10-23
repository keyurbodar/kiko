import { sha256Hex } from "@kiko/durable/hash"
import { escapeAttr, escapeXml } from "./text"
import type { Envelope, Sender } from "./envelope"

export type Refusal = "full" | "too_large"

type Admission = {
  admitted: string[]
  inserted: number
  refused?: Refusal
}

export type Batch = {
  requestId: string
  envelopes: Envelope[]
  briefs: string[]
}

export async function requestIdFor(ids: readonly string[]): Promise<string> {
  return `burst:${await sha256Hex(ids.join("\n"))}`
}

export function renderInput(batch: Pick<Batch, "envelopes" | "briefs">, memory?: string): string {
  const parts = [
    ...(memory ? [memory] : []),
    ...batch.briefs.map((brief) => `<context>\n${brief.replaceAll("</context>", "&lt;/context>")}\n</context>`),
  ]
  for (const { from, body, hop, work } of batch.envelopes) {
    if (from.kind === "human") parts.push(body)
    else if (work)
      parts.push(`<work id="${escapeAttr(work.id)}" status="${escapeAttr(work.status)}">\n${escapeXml(body)}\n</work>`)
    else if (from.kind === "agent")
      parts.push(`<agent-message from="${escapeAttr(from.slug)}" hop="${hop}">\n${escapeXml(body)}\n</agent-message>`)
    else parts.push(`<system-event reason="${escapeAttr(from.reason)}">\n${escapeXml(body)}\n</system-event>`)
  }
  const human = batch.envelopes.filter((e) => e.from.kind === "human" && e.id.startsWith("human:"))
  const [only] = human
  if (human.length === 1 && only) parts.push(`<context>message id: ${only.id.slice(6)}</context>`)
  if (human.length > 1)
    parts.push(
      `<context>\nmessage ids, oldest first:\n${human.map((e) => `${e.id.slice(6)}: ${escapeXml(e.body.slice(0, 40))}`).join("\n")}\n</context>`,
    )
  return parts.join("\n\n")
}
