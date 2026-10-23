import { createSignal } from "solid-js"

export interface EmojiEntry {
  readonly emoji: string
  readonly annotation: string
  readonly shortcodes: readonly string[]
  readonly tags: readonly string[]
  readonly group: number
  readonly order: number
  readonly version: number
}

export const EMOJI_SECTIONS: readonly { readonly title: string; readonly groups: readonly number[] }[] = [
  { title: "Smileys & people", groups: [0, 1] },
  { title: "Animals & nature", groups: [3] },
  { title: "Food & drink", groups: [4] },
  { title: "Travel & places", groups: [5] },
  { title: "Activities", groups: [6] },
  { title: "Objects", groups: [7] },
  { title: "Symbols", groups: [8] },
  { title: "Flags", groups: [9] },
]

const SHOWN_GROUPS = new Set(EMOJI_SECTIONS.flatMap((section) => section.groups))

let loading: Promise<readonly EmojiEntry[]> | undefined

export function loadEmoji(): Promise<readonly EmojiEntry[]> {
  loading ??= fetch("/emoji-picker-data.json")
    .then((response) => {
      if (!response.ok) throw new Error(`emoji data ${response.status}`)
      return response.json() as Promise<EmojiEntry[]>
    })
    .then((entries) => {
      const shown = entries.filter((entry) => SHOWN_GROUPS.has(entry.group)).sort((a, b) => a.order - b.order)
      const newest = typeof document === "undefined" ? Infinity : newestSupported(shown, drawsAsOneGlyph)
      return shown.filter((entry) => entry.version <= newest)
    })
    .catch((error: unknown) => {
      loading = undefined
      throw error
    })
  return loading
}

export function newestSupported(entries: readonly EmojiEntry[], draws: (emoji: string) => boolean): number {
  const probes = new Map<number, string>()
  for (const entry of entries) if (!probes.has(entry.version)) probes.set(entry.version, entry.emoji)
  const versions = [...probes.keys()].sort((a, b) => b - a)
  for (const version of versions) if (draws(probes.get(version)!)) return version
  return versions.at(-1) ?? Infinity
}

export const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'

function drawsAsOneGlyph(emoji: string): boolean {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 24
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) return true
  context.font = `20px ${EMOJI_FONT}`
  context.textBaseline = "top"
  context.fillStyle = "#000"
  if (context.measureText(emoji).width > context.measureText("😀").width * 1.5) return false
  context.fillText(emoji, 0, 0)
  const pixels = context.getImageData(0, 0, 24, 24).data
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3]! > 0 && (pixels[i] !== pixels[i + 1] || pixels[i + 1] !== pixels[i + 2])) return true
  }
  return false
}

export function warmEmoji(): void {
  void loadEmoji().catch(() => undefined)
}

export const DEFAULT_RECENTS: readonly string[] = [
  "🙂",
  "❤️",
  "😂",
  "🔥",
  "😢",
  "😭",
  "👍",
  "🤔",
  "❤️‍🔥",
  "🫡",
  "☹️",
  "🤥",
  "💙",
]

const RECENTS_KEY = "kiko.emoji.recent"
const RECENTS_MAX = 32

export function pushRecent(list: readonly string[], emoji: string, max = RECENTS_MAX): string[] {
  return [emoji, ...list.filter((entry) => entry !== emoji)].slice(0, max)
}

export function withDefaults(stored: readonly string[]): string[] {
  return [...stored, ...DEFAULT_RECENTS.filter((entry) => !stored.includes(entry))]
}

function readStored(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : []
  } catch {
    return []
  }
}

const [stored, setStored] = createSignal<string[]>(typeof window === "undefined" ? [] : readStored())

export const recentEmoji = () => withDefaults(stored())

export function recordRecent(emoji: string): void {
  const next = pushRecent(stored(), emoji)
  setStored(next)
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
  } catch {}
}

export interface EmojiMatch {
  readonly entry: EmojiEntry
  readonly shortcode: string
  readonly at: number
}

export function searchEmoji(entries: readonly EmojiEntry[], query: string, limit = 50): EmojiMatch[] {
  const text = query.trim().toLowerCase()
  if (text === "") return []
  const code = text.replace(/\s+/g, "_")
  const tiers: EmojiMatch[][] = [[], [], [], []]
  for (const entry of entries) {
    if (entry.shortcodes.includes(code)) {
      tiers[0]!.push({ entry, shortcode: code, at: 0 })
      continue
    }
    const prefix = entry.shortcodes.find((shortcode) => shortcode.startsWith(code))
    if (prefix !== undefined) {
      tiers[1]!.push({ entry, shortcode: prefix, at: 0 })
      continue
    }
    const inner = entry.shortcodes.find((shortcode) => shortcode.includes(code))
    if (inner !== undefined) {
      tiers[2]!.push({ entry, shortcode: inner, at: inner.indexOf(code) })
      continue
    }
    if (entry.annotation.includes(text) || entry.tags.some((tag) => tag.startsWith(text))) {
      tiers[3]!.push({ entry, shortcode: entry.shortcodes[0] ?? entry.annotation.replace(/\s+/g, "_"), at: -1 })
    }
  }
  return tiers.flat().slice(0, limit)
}

export function shortcodeQuery(text: string, caret: number): { start: number; query: string } | undefined {
  const match = /(^|\s):([a-z0-9_+-]{2,})$/i.exec(text.slice(0, caret))
  if (!match) return undefined
  const query = match[2]!
  return { start: caret - query.length - 1, query: query.toLowerCase() }
}

export interface GridAt {
  readonly section: number
  readonly index: number
}

export function gridMove(sizes: readonly number[], at: GridAt, key: string, columns: number): GridAt {
  const size = (section: number) => sizes[section] ?? 0
  const nonEmpty = (from: number, step: 1 | -1) => {
    for (let section = from; section >= 0 && section < sizes.length; section += step) {
      if (size(section) > 0) return section
    }
    return undefined
  }
  if (key === "ArrowRight") {
    if (at.index + 1 < size(at.section)) return { section: at.section, index: at.index + 1 }
    const next = nonEmpty(at.section + 1, 1)
    return next === undefined ? at : { section: next, index: 0 }
  }
  if (key === "ArrowLeft") {
    if (at.index > 0) return { section: at.section, index: at.index - 1 }
    const previous = nonEmpty(at.section - 1, -1)
    return previous === undefined ? at : { section: previous, index: size(previous) - 1 }
  }
  const column = at.index % columns
  if (key === "ArrowDown") {
    if (at.index + columns < size(at.section)) return { section: at.section, index: at.index + columns }
    const lastRow = Math.floor((size(at.section) - 1) / columns)
    if (Math.floor(at.index / columns) < lastRow) return { section: at.section, index: size(at.section) - 1 }
    const next = nonEmpty(at.section + 1, 1)
    return next === undefined ? at : { section: next, index: Math.min(column, size(next) - 1) }
  }
  if (key === "ArrowUp") {
    if (at.index - columns >= 0) return { section: at.section, index: at.index - columns }
    const previous = nonEmpty(at.section - 1, -1)
    if (previous === undefined) return at
    const lastRowStart = Math.floor((size(previous) - 1) / columns) * columns
    return { section: previous, index: Math.min(lastRowStart + column, size(previous) - 1) }
  }
  return at
}
