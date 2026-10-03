import type { MessageId, RoomEvent } from "@kiko/protocol"
import { normalizeUrl, type PreviewEnv, resolvePreview } from "../previews/resolve"
import { extractLinks } from "./catalog"
import type { RoomLog } from "./log"

// Telegram style: the room reads the first link of every message and stores the card on the
// message (architecture section 18.2). It runs after the message is stored and sent, so it never
// holds up a send, and it waits on no other Durable Object. Agents never see the card.

/** The URL whose card a message shows: the first link of its text. A message with files shows none. */
export function previewUrl(text: string): string | null {
  const first = extractLinks(text)[0]
  return first ? normalizeUrl(first.url) : null
}

/**
 * True when a human message holds this link (section 16.4). A tainted run's link is previewed only
 * then: the human chose to share it, so the fetch carries nothing the run made up.
 */
export function humanWrote(sql: SqlStorage, url: string): boolean {
  const host = new URL(url).host
  return sql
    .exec<{ text: string }>("SELECT text FROM messages WHERE deleted_at IS NULL AND instr(text, ?) > 0 AND json_extract(sender, '$.kind') = 'human'", host)
    .toArray()
    .some((m) => extractLinks(m.text).some((l) => normalizeUrl(l.url) === url))
}

/** The message and link to read for a stored event, or null when the event needs no card. */
export function previewTarget(event: RoomEvent): { messageId: MessageId; url: string } | null {
  if (event.t === "message") {
    if (event.files?.length || event.preview) return null
    const url = previewUrl(event.text)
    return url ? { messageId: event.id, url } : null
  }
  if (event.t === "edit") {
    const url = previewUrl(event.text)
    return url ? { messageId: event.messageId, url } : null
  }
  return null
}

/**
 * Resolves the card and stores it. Safe to run twice: the log stores an unchanged card once. A
 * message deleted, or edited to another link, while the page loaded gets nothing.
 */
export async function attachPreview(
  log: RoomLog,
  env: Partial<PreviewEnv>,
  target: { messageId: MessageId; url: string },
  waitUntil: (work: Promise<unknown>) => void,
  publish: (events: RoomEvent[]) => void,
): Promise<void> {
  if (!env.PREVIEWS || !env.BETTER_AUTH_SECRET) return
  try {
    const { preview } = await resolvePreview(env as PreviewEnv, target.url, waitUntil)
    if (!preview) return
    const message = log.message(target.messageId)
    if (!message || previewUrl(message.text) !== target.url) return
    const event = log.setPreview(target.messageId, preview)
    if (event) publish([event])
  } catch (e) {
    console.error(`link preview failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}
