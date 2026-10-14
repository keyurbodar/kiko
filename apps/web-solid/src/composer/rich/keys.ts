import { joinTextblockBackward, joinTextblockForward, newlineInCode } from "@tiptap/pm/commands"
import { liftListItem, splitListItem } from "@tiptap/pm/schema-list"
import { liftTarget } from "@tiptap/pm/transform"
import { Fragment, type Node, type ResolvedPos } from "@tiptap/pm/model"
import { Selection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state"
import { nextOrderedMarker } from "./markdown"

type Dispatch = ((tr: Transaction) => void) | undefined

function hasAncestor($pos: ResolvedPos, name: string): boolean {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === name) return true
  }
  return false
}

/**
 * Shift+Enter in a list item: a new item, or one level out when the item is empty. Enter sends, so
 * this is the only way a list gets its next line from the keyboard, as in t3code.
 */
export function splitOrLeaveListItem(state: EditorState, dispatch?: Dispatch): boolean {
  const { $from } = state.selection
  if ($from.depth < 2) return false
  const name = $from.node($from.depth - 1).type.name
  if (name !== "listItem" && name !== "taskItem") return false
  const type = state.schema.nodes[name]!
  // A new task starts unchecked. A new bullet copies its marker; a new ordered item counts on from it.
  const attrs = name === "taskItem" ? { checked: false } : undefined
  const split = splitListItem(type, attrs)(state, dispatch && ((tr) => dispatch(numberSplitItems(tr))))
  return split || ($from.parent.content.size === 0 && liftListItem(type)(state, dispatch))
}

/**
 * Gives the item the caret is in, and the items after it, their ordered markers. The split copies the
 * marker of the item it came from, so without this every new line of `3)` would read `3)` again.
 */
function numberSplitItems(tr: Transaction): Transaction {
  const { $from } = tr.selection
  const list = $from.node(-2)
  const index = $from.index(-2)
  if (list.type.name !== "orderedList" || index === 0) return tr
  const above = list.child(index - 1).attrs.marker
  if (typeof above !== "string" || !ORDERED_MARKER.test(above)) return tr
  let previous = above
  const listPos = $from.before(-2)
  list.forEach((child, offset, childIndex) => {
    if (childIndex < index) return
    previous = nextOrderedMarker(previous)
    if (child.attrs.marker !== previous) tr.setNodeMarkup(listPos + 1 + offset, undefined, { ...child.attrs, marker: previous })
  })
  return tr
}

const ORDERED_MARKER = /^\d+[.)]$/

/**
 * `[ ] ` typed at the start of a bullet item turns that item into a task. A task list holds only tasks,
 * so the bullet list splits around it. Ordered items and text after the box are not converted.
 */
export function bulletItemToTask(tr: Transaction, from: number, to: number, checked: boolean): void {
  tr.delete(from, to)
  const $pos = tr.doc.resolve(from)
  const list = $pos.node(-2)
  const index = $pos.index(-2)
  const before: Node[] = []
  const after: Node[] = []
  list.forEach((child, _, childIndex) => {
    if (childIndex < index) before.push(child)
    else if (childIndex > index) after.push(child)
  })
  const item = $pos.node(-1)
  const { schema } = tr.doc.type
  const task = schema.nodes.taskItem!.create({ checked }, item.content)
  const lists = [
    ...(before.length ? [list.copy(Fragment.from(before))] : []),
    schema.nodes.taskList!.create(null, task),
    ...(after.length ? [list.copy(Fragment.from(after))] : []),
  ]
  const listStart = $pos.before(-2)
  tr.replaceWith(listStart, listStart + list.nodeSize, lists)
  // Past the list (and the bullets before it), the task item and its paragraph: the caret is in the text.
  tr.setSelection(TextSelection.create(tr.doc, listStart + (before.length ? lists[0]!.nodeSize : 0) + 3))
}

/** The list item a paragraph sits in, as the schema names it, or null for any other place. */
function listItemName($pos: ResolvedPos): "listItem" | "taskItem" | null {
  if ($pos.depth < 2) return null
  const name = $pos.node(-1).type.name
  return name === "listItem" || name === "taskItem" ? name : null
}

/**
 * Backspace at the start of an item's text lifts the item one level: out of a nested list, or out of
 * the list at the top, as a paragraph. Backspace at the start of a line right after a list joins that
 * line onto the list's last line. Otherwise the default delete runs.
 */
export function backspaceAcrossList(state: EditorState, dispatch?: Dispatch): boolean {
  const { $from, empty } = state.selection
  if (!empty || $from.parentOffset !== 0) return false
  const item = listItemName($from)
  if (item && $from.index(-1) === 0) return liftListItem(state.schema.nodes[item]!)(state, dispatch)
  const before = $from.depth === 1 ? $from.node(0).maybeChild($from.index(0) - 1) : null
  if (before && LIST_NODES.has(before.type.name) && $from.parent.type.name !== "codeBlock") {
    return joinTextblockBackward(state, dispatch)
  }
  return false
}

const LIST_NODES = new Set(["bulletList", "orderedList", "taskList"])

/**
 * Delete at the end of a line next to list structure pulls the next line's text up onto it. The default
 * would nest the next item under this one. Before a fence it does nothing, so the code keeps its fence.
 */
export function deleteAcrossList(state: EditorState, dispatch?: Dispatch): boolean {
  const { $from, empty } = state.selection
  if (!empty || !$from.parent.isTextblock || $from.depth === 0) return false
  if ($from.parentOffset !== $from.parent.content.size) return false
  const next = Selection.findFrom(state.doc.resolve($from.after()), 1, true)
  if (!next) return false
  if (next.$from.parent.type.name === "codeBlock") return $from.parent.type.name !== "codeBlock"
  if (!listItemName($from) && !listItemName(next.$from)) return false
  return joinTextblockForward(state, dispatch)
}

/**
 * Shift+Enter on the empty line at the end of a quote leaves the quote, as t3code does. A quote line
 * ends with a hard break once Shift+Enter has been pressed in it, so the empty line is that break's
 * tail: the break goes, and the paragraph is lifted out of the quote.
 */
export function leaveEmptyQuote(state: EditorState, dispatch?: Dispatch): boolean {
  const { $from, empty } = state.selection
  if (!empty || !hasAncestor($from, "blockquote")) return false
  const { parent } = $from
  const endsInBreak = $from.parentOffset === parent.content.size && parent.lastChild?.type.name === "hardBreak"
  if (parent.content.size !== 0 && !endsInBreak) return false
  if (dispatch) {
    const tr = state.tr
    let pos = $from.pos
    if (endsInBreak) {
      // The break becomes a paragraph edge, so the empty line is its own paragraph to lift.
      tr.delete(pos - 1, pos)
      tr.split(pos - 1)
      pos += 1
    }
    const range = tr.doc.resolve(pos).blockRange()
    const target = range ? liftTarget(range) : null
    if (range && target !== null) tr.lift(range, target)
    dispatch(tr.scrollIntoView())
  }
  return true
}

/** Shift+Enter inside a fence is a line of code. */
export function shiftEnterInCode(state: EditorState, dispatch?: Dispatch): boolean {
  return newlineInCode(state, dispatch)
}

/** Enter on a line of backticks turns it into a fence, the gesture every markdown editor has. */
export function openFenceOnEnter(state: EditorState, dispatch?: Dispatch): boolean {
  const { $from, empty } = state.selection
  if (!empty || $from.parent.type.name !== "paragraph" || $from.depth !== 1) return false
  if ($from.parentOffset !== $from.parent.content.size) return false
  const match = /^`{3,}([^`]*)$/.exec($from.parent.textContent)
  if (!match) return false
  if (dispatch) {
    const start = $from.before()
    const block = state.schema.nodes.codeBlock!.create({ language: (match[1] ?? "").trim() || null })
    const tr = state.tr.replaceWith(start, $from.after(), block)
    dispatch(tr.setSelection(TextSelection.create(tr.doc, start + 1)).scrollIntoView())
  }
  return true
}

/**
 * Tab and Shift+Tab inside a fence. A caret indents in place. A selection indents the whole lines it
 * touches, so a block can be re-indented, as in t3code.
 */
export function indentInCode(state: EditorState, outdent: boolean, dispatch?: Dispatch): boolean {
  const { $from, $to, from, to } = state.selection
  if ($from.parent.type.name !== "codeBlock" || !$to.sameParent($from)) return false
  if (from === to && !outdent) {
    dispatch?.(state.tr.insertText("  ", from, to).scrollIntoView())
    return true
  }
  const base = $from.start()
  const text = $from.parent.textContent
  const startOffset = from - base
  const endOffset = to - base
  const lineStart = text.lastIndexOf("\n", Math.max(0, startOffset - 1)) + 1
  const newline = text.indexOf("\n", Math.max(startOffset, endOffset - 1))
  const lineEnd = newline === -1 ? text.length : newline
  const lines = text.slice(lineStart, lineEnd).split("\n")
  const next = lines.map((line) => {
    if (!outdent) return line.length === 0 ? line : `  ${line}`
    if (line.startsWith("  ")) return line.slice(2)
    if (line.startsWith("\t") || line.startsWith(" ")) return line.slice(1)
    return line
  })
  if (next.join("\n") !== lines.join("\n")) {
    dispatch?.(state.tr.insertText(next.join("\n"), base + lineStart, base + lineEnd).scrollIntoView())
  }
  return true
}
