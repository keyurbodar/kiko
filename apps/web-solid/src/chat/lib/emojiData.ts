import type { CompactEmoji, GroupKey } from "emojibase"
import compact from "emojibase-data/en/compact.json"
import shortcodePreset from "emojibase-data/en/shortcodes/emojibase.json"

/** One selectable emoji. Skin-tone variants are not expanded. */
export interface EmojiEntry {
  /** The emoji character, ready to drop into a message. */
  emoji: string
  hexcode: string
  label: string
  group: number
  shortcodes: readonly string[]
  tags: readonly string[]
}

export interface EmojiGroup {
  group: number
  key: GroupKey
  /** Lowercase, because it is chrome. */
  label: string
  emojis: readonly EmojiEntry[]
}

/** A search never renders more than this, so a one-letter query stays usable. */
const SEARCH_LIMIT = 240

interface GroupSpec {
  group: number
  key: GroupKey
  label: string
}

/**
 * emojibase's own group order, minus `component`: those are the skin-tone and
 * keycap parts, not pictographs anybody picks from a menu.
 */
const GROUP_SPECS: readonly GroupSpec[] = [
  { group: 0, key: "smileys-emotion", label: "smileys & emotion" },
  { group: 1, key: "people-body", label: "people & body" },
  { group: 3, key: "animals-nature", label: "animals & nature" },
  { group: 4, key: "food-drink", label: "food & drink" },
  { group: 5, key: "travel-places", label: "travel & places" },
  { group: 6, key: "activities", label: "activities" },
  { group: 7, key: "objects", label: "objects" },
  { group: 8, key: "symbols", label: "symbols" },
  { group: 9, key: "flags", label: "flags" },
]

/** emojibase stores a lone shortcode as a bare string, so both shapes occur. */
function toShortcodes(value: string[] | string | undefined): string[] {
  if (value === undefined) return []
  return typeof value === "string" ? [value] : value
}

const shortcodesByHexcode: Record<string, string[] | string> = shortcodePreset

function toEntry(compactEmoji: CompactEmoji): EmojiEntry {
  return {
    emoji: compactEmoji.unicode,
    hexcode: compactEmoji.hexcode,
    label: compactEmoji.label,
    group: compactEmoji.group ?? -1,
    shortcodes: toShortcodes(shortcodesByHexcode[compactEmoji.hexcode]),
    tags: compactEmoji.tags ?? [],
  }
}

// The dataset is bundled, so the whole index is built once at module scope and
// every read after that is a lookup.
const ENTRIES: readonly EmojiEntry[] = compact.filter((item) => item.group !== undefined && item.group !== 2).map(toEntry)

/** Label, tags and shortcodes folded into one lowercase haystack per entry. */
const HAYSTACKS: readonly string[] = ENTRIES.map((entry) =>
  `${entry.label} ${entry.tags.join(" ")} ${entry.shortcodes.join(" ")}`.toLowerCase(),
)

const BY_SHORTCODE: Record<string, EmojiEntry> = {}
for (const entry of ENTRIES) {
  for (const shortcode of entry.shortcodes) {
    if (BY_SHORTCODE[shortcode] === undefined) BY_SHORTCODE[shortcode] = entry
  }
}

const GROUPED: readonly EmojiGroup[] = GROUP_SPECS.map((spec) => ({
  ...spec,
  emojis: ENTRIES.filter((entry) => entry.group === spec.group),
})).filter((group) => group.emojis.length > 0)

/** Every group, in menu order, each with its emoji. */
export function groupedEmojis(): readonly EmojiGroup[] {
  return GROUPED
}

/**
 * Matches the label, the tags, or any of the shortcodes. An empty query is not
 * a match-everything: the caller wants the grouped menu for that, not nineteen
 * hundred undifferentiated rows.
 */
export function searchEmojis(query: string): readonly EmojiEntry[] {
  const needle = query.trim().toLowerCase()
  if (needle === "") return []
  const hits: EmojiEntry[] = []
  for (let index = 0; index < ENTRIES.length && hits.length < SEARCH_LIMIT; index++) {
    if (HAYSTACKS[index].includes(needle)) hits.push(ENTRIES[index])
  }
  return hits
}

/** Resolves `fire`, `:fire:` or `FIRE` to the emoji it names. */
export function resolveShortcode(shortcode: string): EmojiEntry | undefined {
  return BY_SHORTCODE[shortcode.trim().replace(/^:|:$/g, "").toLowerCase()]
}
