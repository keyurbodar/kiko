import { type ChatLast, type LastKind, plainText, type RichText } from "@kiko/protocol"

export type ActivityLine = { from?: string; text: string }

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const MEDIA: Partial<Record<LastKind, (last: ChatLast) => string>> = {
  photo: (l) => (l.count ? `${l.count} photos` : "Photo"),
  video: (l) => (l.count ? `${l.count} videos` : "Video"),
  album: () => "Album",
  file: (l) => (l.count ? `${l.count} files` : (l.file ?? "File")),
  voice: () => "Voice message",
  audio: (l) => l.file ?? "Audio",
}

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
  const from = last.from === "human" ? "You" : group && name ? name : undefined
  return from ? { from, text: body } : { text: body }
}

export const isListed = (m: { to?: unknown; event?: object }): boolean =>
  m.to === undefined && !(m.event && "private" in m.event)

export const quoteOf = (m: { body: string; rich?: RichText }, name: (slug: string) => string): string =>
  m.rich?.length ? plainText(m.rich, name) : m.body
