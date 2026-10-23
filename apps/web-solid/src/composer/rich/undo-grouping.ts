import { closeHistory, isHistoryTransaction } from "@tiptap/pm/history"
import type { Transaction } from "@tiptap/pm/state"
import { ReplaceStep } from "@tiptap/pm/transform"

export const UNDO_GROUP_DELAY = 1000

export type ChangeKind = "insert" | "delete" | "other"

function changeKindOf(tr: Transaction): ChangeKind | null {
  if (!tr.docChanged) return null
  const uiEvent = tr.getMeta("uiEvent")
  if (uiEvent === "paste" || uiEvent === "drop" || uiEvent === "cut") return "other"
  if (tr.getMeta("composition") != null) return "insert"
  let kind: ChangeKind | null = null
  for (const step of tr.steps) {
    if (!(step instanceof ReplaceStep)) return "other"
    const inserts = step.slice.size > 0
    const deletes = step.to > step.from
    const stepKind = inserts && !deletes ? "insert" : deletes && !inserts ? "delete" : "other"
    if (kind !== null && kind !== stepKind) return "other"
    kind = stepKind
  }
  return kind
}

export function groupUndoByChangeKind(tr: Transaction, previous: ChangeKind | null): ChangeKind | null {
  if (isHistoryTransaction(tr)) return "other"
  const kind = changeKindOf(tr)
  if (kind === null) return previous
  if (previous !== null && (kind !== previous || kind === "other")) closeHistory(tr)
  return kind
}
