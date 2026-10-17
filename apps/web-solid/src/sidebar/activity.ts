import { type ChatLast, type LastKind, plainText, type RichText } from "@kiko/protocol"

// The chat list's second line. The room sends the newest
// activity as data (`ChatLast`); this file is the one place that turns it into words. A DM names
// nobody but you; a group names whoever did it. The words are sentence case; names and message
// text stay as they are.

/** The line, split so the row can tint who said it. `from` is absent when nobody is named. */
export type ActivityLine = { from?: string; text: string }

/** The line's first letter in capitals, for a line that does not open with a name. */
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** What a message with files says before its caption. */
const MEDIA: Partial<Record<LastKind, (last: ChatLast) => string>> = {
  photo: (l) => (l.count ? `${l.count} photos` : "Photo"),
  video: (l) => (l.count ? `${l.count} videos` : "Video"),
  album: () => "Album",
  file: (l) => (l.count ? `${l.count} files` : (l.file ?? "File")),
  voice: () => "Voice message",
  audio: (l) => l.file ?? "Audio",
}

/** The words of one activity. `group` is true when the chat has more than one agent. */
export function describeLast(last: ChatLast, group: boolean): ActivityLine {
  const name = last.name ?? ""
  const actor = group && name ? `${name} ` : ""
  switch (last.kind) {
    case "react":
      return { text: sentence(`${actor}reacted ${last.emoji ?? ""} to "${last.text ?? ""}"`) }
    case "joined":
    case "left":
      return { text: `${name} ${last.kind}` }
    case "renamed":
      return { text: `You renamed the group to ${last.text ?? ""}` }
    case "created":
      return { text: "You created the group" }
    case "notice":
      return { text: last.text ?? "" }
  }
  const media = MEDIA[last.kind]
  const body = media ? (last.text ? `${media(last)}, ${last.text}` : media(last)) : (last.text ?? "")
  // Your own messages always say so; an agent is named only where there is more than one.
  const from = last.from === "human" ? "You" : group && name ? name : undefined
  return from ? { from, text: body } : { text: body }
}

/** Who is typing, as the row says it: `Typing` in a DM, names in a group. */
export function typingLine(names: readonly string[], group: boolean): string {
  if (!group || names.length === 0) return "Typing"
  const [first, second] = names
  if (names.length === 1) return `${first} is typing`
  if (names.length === 2) return `${first} and ${second} are typing`
  return `${first} and ${names.length - 1} others are typing`
}

/** A message a chat row or its preview card may quote: not a divider, and not mail between agents. */
export const isListed = (m: { to?: unknown; event?: object }): boolean => m.to === undefined && !(m.event && "private" in m.event)

/** What a message says in a preview, as plain words with mentions by name. */
export const quoteOf = (m: { body: string; rich?: RichText }, name: (slug: string) => string): string => (m.rich?.length ? plainText(m.rich, name) : m.body)
