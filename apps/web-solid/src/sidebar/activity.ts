import type { ChatLast, LastKind } from "@kiko/protocol"

// The chat list's second line, worded the way Telegram words it. The room sends the newest
// activity as data (`ChatLast`); this file is the one place that turns it into words. A DM names
// nobody but you; a group names whoever did it. Every word is lowercase; message text stays as sent.

/** The line, split so the row can tint who said it. `from` is absent when nobody is named. */
export type ActivityLine = { from?: string; text: string }

const lower = (name: string | undefined) => (name ?? "").toLowerCase()

/** What a message with files says before its caption. */
const MEDIA: Partial<Record<LastKind, (last: ChatLast) => string>> = {
  photo: (l) => (l.count ? `${l.count} photos` : "photo"),
  video: (l) => (l.count ? `${l.count} videos` : "video"),
  album: () => "album",
  file: (l) => (l.count ? `${l.count} files` : (l.file ?? "file")),
  voice: () => "voice message",
  audio: (l) => l.file ?? "audio",
}

/** The words of one activity. `group` is true when the chat has more than one agent. */
export function describeLast(last: ChatLast, group: boolean): ActivityLine {
  const name = lower(last.name)
  const actor = group && name ? `${name} ` : ""
  switch (last.kind) {
    case "react":
      return { text: `${actor}reacted ${last.emoji ?? ""} to "${last.text ?? ""}"` }
    case "joined":
    case "left":
      return { text: `${name} ${last.kind}` }
    case "renamed":
      return { text: `you renamed the group to ${last.text ?? ""}` }
    case "created":
      return { text: "you created the group" }
    case "approval":
      return { text: `${actor}needs your approval` }
    case "notice":
      return { text: last.text ?? "" }
  }
  const media = MEDIA[last.kind]
  const body = media ? (last.text ? `${media(last)}, ${last.text}` : media(last)) : (last.text ?? "")
  // Your own messages always say so; an agent is named only where there is more than one.
  const from = last.from === "human" ? "you" : group && name ? name : undefined
  return from ? { from, text: body } : { text: body }
}

/** Who is typing, as the row says it: `typing` in a DM, names in a group. */
export function typingLine(names: readonly string[], group: boolean): string {
  if (!group || names.length === 0) return "typing"
  const [first, second] = names.map(lower)
  if (names.length === 1) return `${first} is typing`
  if (names.length === 2) return `${first} and ${second} are typing`
  return `${first} and ${names.length - 1} others are typing`
}
