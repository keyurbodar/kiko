export interface Said {
  readonly id: string
  readonly seq: number
  readonly at: number
  readonly agent: boolean
}

export interface UnreadLine {
  readonly anchor: string | null
  readonly awayFrom: number | null
  readonly backAt: number | null
}

export const NO_LINE: UnreadLine = { anchor: null, awayFrom: null, backAt: null }

const firstAfter = (messages: readonly Said[], seq: number, before = Number.POSITIVE_INFINITY): string | null =>
  messages.find((m) => m.agent && m.seq > seq && m.at <= before)?.id ?? null

export const openLine = (messages: readonly Said[], readSeq: number, hidden: boolean): UnreadLine => ({
  anchor: firstAfter(messages, readSeq),
  awayFrom: hidden ? readSeq : null,
  backAt: null,
})

export const hideLine = (line: UnreadLine, messages: readonly Said[]): UnreadLine => ({
  ...line,
  awayFrom: messages.at(-1)?.seq ?? 0,
  backAt: null,
})

export const showLine = (line: UnreadLine, now: number): UnreadLine =>
  line.awayFrom === null ? line : { ...line, backAt: now }

export function arriveLine(line: UnreadLine, messages: readonly Said[]): UnreadLine {
  if (line.anchor !== null || line.awayFrom === null) return line
  const anchor = firstAfter(messages, line.awayFrom, line.backAt ?? undefined)
  return anchor === null ? line : { ...line, anchor }
}

export const sendLine = (line: UnreadLine): UnreadLine =>
  line.anchor === null && line.awayFrom === null ? line : NO_LINE
