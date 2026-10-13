// What an update changes in the review: the power lines new in this version, the ones it drops, and
// how many stay the same. Lines are compared by text, so a changed tool shows as one dropped, one new.
import type { ReviewLine } from "@kiko/protocol"

export type ReviewChange = { added: ReviewLine[]; removed: ReviewLine[]; unchanged: number }

export function reviewChange(before: ReviewLine[], after: ReviewLine[]): ReviewChange {
  const was = new Set(before.map((l) => l.text))
  const now = new Set(after.map((l) => l.text))
  return {
    added: after.filter((l) => !was.has(l.text)),
    removed: before.filter((l) => !now.has(l.text)),
    unchanged: after.filter((l) => was.has(l.text)).length,
  }
}
