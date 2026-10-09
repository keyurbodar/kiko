import type { OutfitId } from "./birds"

// The world the birds live in, as data: the season and the part of the day. The brand mark and
// the empty chat read it, so Yuki wears first snow in winter and the empty chat gets a moon at night.

export type Season = "winter" | "spring" | "summer" | "autumn"
export type Daypart = "morning" | "day" | "evening" | "night"

export function seasonOf(date: Date): Season {
  const m = date.getMonth()
  if (m === 11 || m <= 1) return "winter"
  if (m <= 4) return "spring"
  if (m <= 7) return "summer"
  return "autumn"
}

export function daypartOf(date: Date): Daypart {
  const h = date.getHours()
  if (h >= 5 && h < 11) return "morning"
  if (h >= 11 && h < 17) return "day"
  if (h >= 17 && h < 22) return "evening"
  return "night"
}

/** What Yuki wears for the season: snow on its crown, a blossom, nothing in summer, a maple leaf. */
export const SEASON_OUTFIT: Record<Season, OutfitId> = { winter: "snowcap", spring: "blossom", summer: "none", autumn: "momiji" }

/** The empty chat's one quiet line. No instructions; the composer's placeholder says who to message. */
export const GREETING: Record<Daypart, string> = {
  morning: "Morning. What's on your mind?",
  day: "What's on your mind?",
  evening: "Evening. What's on your mind?",
  night: "Still up? What's on your mind?",
}
