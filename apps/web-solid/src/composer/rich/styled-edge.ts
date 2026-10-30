import { Mark } from "@tiptap/pm/model"
import type { EditorState, Transaction } from "@tiptap/pm/state"

function styledEdge(state: EditorState) {
  const { selection } = state
  if (!selection.empty) return null
  const { $from } = selection
  if (!$from.parent.inlineContent) return null
  const before = $from.nodeBefore?.marks ?? Mark.none
  const after = $from.nodeAfter?.marks ?? Mark.none
  if (Mark.sameSet(before, after)) return null
  const current = state.storedMarks ?? $from.marks()
  const side = Mark.sameSet(current, before) ? "before" : Mark.sameSet(current, after) ? "after" : null
  return side ? { before, after, side } : null
}

export function caretTakesMarksBefore(state: EditorState): boolean {
  return styledEdge(state)?.side === "before"
}

export function stepCaretAcrossStyledEdge(state: EditorState, direction: -1 | 1): Transaction | null {
  const edge = styledEdge(state)
  if (!edge || edge.side === (direction === -1 ? "before" : "after")) return null
  return state.tr.setStoredMarks(direction === -1 ? edge.before : edge.after)
}
