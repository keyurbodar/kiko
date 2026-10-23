import type { AgentSlug, Envelope, FileRef, RoomEvent, SystemEvent, SystemReason } from "@kiko/protocol"
import type { RoomLog } from "./log"
import type { Pending } from "./burst"
import { type RecipientMember, resolveRecipients } from "./recipients"

const MAX_ATTACHED_BYTES = 4 * 1024

function attachedLine(files: readonly FileRef[]): string {
  const names: string[] = []
  let bytes = 0
  for (const [i, f] of files.entries()) {
    const name = `/${f.name} (${f.type || "file"}, ${Math.max(1, Math.round(f.size / 1024))} kb)`
    bytes += new TextEncoder().encode(JSON.stringify(name)).length + 2
    if (bytes > MAX_ATTACHED_BYTES) {
      names.push(`and ${files.length - i} more`)
      break
    }
    names.push(name)
  }
  return `(attached: ${names.join(", ")}. open each with read before you answer about it.)`
}

const WORKSPACE_LINK = /\]\((?:<(\/[^>\n]+)>|(\/[^)\s<>]+))\)/g

function referencedFiles(text: string, attached: readonly FileRef[] = []): string[] {
  const named = new Set(attached.map((f) => `/${f.name}`))
  const out = new Set<string>()
  for (const m of text.matchAll(WORKSPACE_LINK)) {
    const path = (m[1] ?? m[2])!
    if (!path.startsWith("//") && !named.has(path)) out.add(path)
  }
  return [...out].slice(0, 20)
}

export function route(
  pending: readonly Pending[],
  members: readonly RecipientMember[],
  addressees: (messageId: string) => readonly string[],
): Map<AgentSlug, Envelope[]> {
  const out = new Map<AgentSlug, Envelope[]>()
  for (const { envelope: e, mentions } of pending) {
    const replyTo = e.replyTo ? addressees(e.replyTo) : []
    for (const slug of resolveRecipients({ mentions, replyTo }, members)) {
      out.set(slug, [...(out.get(slug) ?? []), e])
    }
  }
  return out
}

export function withContext(log: RoomLog, e: Envelope): Envelope {
  if (e.from.kind !== "human") return e
  const message = log.message(e.rootId)
  if (!message) return e
  const lines: string[] = []
  const quoted = message.replyTo ? log.message(message.replyTo) : null
  if (quoted) {
    const by =
      quoted.from.kind === "agent" ? `@${quoted.from.slug}` : quoted.from.kind === "human" ? "the human" : "the room"
    lines.push(
      message.quote
        ? `(replying to ${by}, about this part: "${message.quote.replace(/\s+/g, " ").slice(0, 600)}")`
        : `(replying to ${by}: "${quoted.text.replace(/\s+/g, " ").slice(0, 400)}")`,
    )
  }
  if (e.body.trim()) lines.push(e.body)
  if (message.files?.length) lines.push(attachedLine(message.files))
  const referenced = referencedFiles(e.body, message.files)
  if (referenced.length)
    lines.push(
      `(referenced: ${referenced.join(", ")}. open a file with read, or list a folder with ls, before you answer about it.)`,
    )
  return lines.length ? { ...e, body: lines.join("\n") } : e
}

export class Deliveries {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly log: RoomLog,
  ) {}

  notice(id: string, text: string, reason: SystemReason = "run_budget", detail?: SystemEvent): RoomEvent | null {
    return this.log.addMessage({
      from: { kind: "system", reason },
      text,
      clientId: `notice:${id}`,
      ...(detail ? { event: detail } : {}),
    }).event
  }
}
