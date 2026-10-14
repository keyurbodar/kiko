import { exitCode, joinTextblockBackward, joinTextblockForward, newlineInCode } from "@tiptap/pm/commands"
import { liftListItem, splitListItem } from "@tiptap/pm/schema-list"
import { liftTarget } from "@tiptap/pm/transform"
import { Fragment, type Node, type ResolvedPos } from "@tiptap/pm/model"
import { Selection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"
import { nextOrderedMarker } from "./markdown"

type Dispatch = ((tr: Transaction) => void) | undefined

function hasAncestor($pos: ResolvedPos, name: string): boolean {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === name) return true
  }
  return false
}

export function splitOrLeaveListItem(state: EditorState, dispatch?: Dispatch): boolean {
  const { $from } = state.selection
  if ($from.depth < 2) return false
  const name = $from.node($from.depth - 1).type.name
  if (name !== "listItem" && name !== "taskItem") return false
  const type = state.schema.nodes[name]!
  const attrs = name === "taskItem" ? { checked: false } : undefined
  const split = splitListItem(type, attrs)(state, dispatch && ((tr) => dispatch(numberSplitItems(tr))))
  return split || ($from.parent.content.size === 0 && liftListItem(type)(state, dispatch))
}

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
  tr.setSelection(TextSelection.create(tr.doc, listStart + (before.length ? lists[0]!.nodeSize : 0) + 3))
}

function listItemName($pos: ResolvedPos): "listItem" | "taskItem" | null {
  if ($pos.depth < 2) return null
  const name = $pos.node(-1).type.name
  return name === "listItem" || name === "taskItem" ? name : null
}

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

export function shiftEnterInCode(state: EditorState, dispatch?: Dispatch): boolean {
  return newlineInCode(state, dispatch)
}

export function parseOpeningFence(line: string): { fence: string; language: string } | null {
  const match = /^(`{3,}|~{3,})([^\n]*)$/.exec(line)
  if (!match) return null
  const fence = match[1]!
  const language = match[2]!
  if (fence.startsWith("`") && language.includes("`")) return null
  return { fence, language }
}

export function isClosingFence(line: string, fence: string): boolean {
  const match = /^(`{3,}|~{3,})[ \t]*$/.exec(line)
  if (!match) return false
  const run = match[1]!
  return run[0] === fence[0] && run.length >= fence.length
}

export function selectionInOneCodeBlock(state: EditorState): boolean {
  const { $from, $to } = state.selection
  return $from.parent.type.spec.code === true && $from.sameParent($to)
}

function codeBlockRange(state: EditorState): { from: number; to: number; text: string } | null {
  const { $from, $to } = state.selection
  const parent = $from.parent
  if (parent.type.spec.code !== true || !$from.sameParent($to)) return null
  const from = $from.start()
  return { from, to: from + parent.content.size, text: parent.textContent }
}

export function openFenceOnEnter(state: EditorState, dispatch?: Dispatch): boolean {
  const { $from, empty } = state.selection
  if (!empty || $from.parent.type.name !== "paragraph" || $from.depth !== 1) return false
  if ($from.parentOffset !== $from.parent.content.size) return false
  const opening = parseOpeningFence($from.parent.textContent)
  const codeBlock = state.schema.nodes.codeBlock
  if (!opening || !codeBlock) return false
  if (dispatch) {
    const start = $from.before()
    const block = codeBlock.create({ language: opening.language, fence: opening.fence, close: `\n${opening.fence}` })
    const tr = state.tr.replaceWith(start, $from.after(), block)
    dispatch(tr.setSelection(TextSelection.create(tr.doc, start + 1)).scrollIntoView())
  }
  return true
}

export function exitCodeBlockOnTrailingBlankLines(view: EditorView): boolean {
  const { $from, empty } = view.state.selection
  if (!empty || $from.parent.type.spec.code !== true) return false
  if ($from.parentOffset !== $from.parent.content.size) return false
  const trailing = /\n[ \t]*\n[ \t]*$/.exec($from.parent.textContent)
  if (!trailing) return false
  const transaction = view.state.tr.delete($from.pos - trailing[0].length, $from.pos)
  if (!$from.parent.attrs.close) {
    transaction.setNodeAttribute($from.before(), "close", `\n${String($from.parent.attrs.fence || "```")}`)
  }
  view.dispatch(transaction)
  return exitCode(view.state, (tr) => view.dispatch(tr.scrollIntoView()))
}

export function exitCodeBlockOnClosingFence(state: EditorState, dispatch?: Dispatch): boolean {
  const block = codeBlockRange(state)
  if (!block || !state.selection.empty) return false
  const caret = state.selection.from - block.from
  const lineStart = block.text.lastIndexOf("\n", caret - 1) + 1
  const newlineAfter = block.text.indexOf("\n", caret)
  const lineEnd = newlineAfter === -1 ? block.text.length : newlineAfter
  const line = block.text.slice(lineStart, lineEnd)
  const node = state.selection.$from.parent
  if (caret !== lineEnd || !isClosingFence(line, String(node.attrs.fence || "```"))) return false
  if (dispatch) {
    const { schema } = state
    const paragraph = (text: string) => schema.nodes.paragraph!.create(null, text ? schema.text(text) : null)
    const code = block.text.slice(0, Math.max(0, lineStart - 1))
    const rest = newlineAfter === -1 ? [] : block.text.slice(newlineAfter + 1).split("\n")
    const closed = node.type.create({ ...node.attrs, close: `\n${line}` }, code ? schema.text(code) : null)
    const start = state.selection.$from.before()
    const transaction = state.tr.replaceWith(start, start + node.nodeSize, [closed, paragraph(""), ...rest.map(paragraph)])
    transaction.setSelection(TextSelection.create(transaction.doc, start + closed.nodeSize + 1))
    dispatch(transaction.scrollIntoView())
  }
  return true
}

export function indentedNewlineInCodeBlock(state: EditorState, dispatch?: Dispatch): boolean {
  const block = codeBlockRange(state)
  if (!block) return false
  const { from, to } = state.selection
  const beforeCursor = block.text.slice(0, from - block.from)
  const currentLine = beforeCursor.slice(beforeCursor.lastIndexOf("\n") + 1)
  const indent = /^[ \t]*/.exec(currentLine)![0]
  if (indent.length === 0) return false
  if (dispatch) {
    const inserted = `\n${indent}`
    const transaction = state.tr.insertText(inserted, from, to)
    transaction.setSelection(TextSelection.create(transaction.doc, from + inserted.length))
    dispatch(transaction.scrollIntoView())
  }
  return true
}

export function unwrapCodeBlockAtStart(state: EditorState, dispatch?: Dispatch): boolean {
  const { $from, empty } = state.selection
  if (!empty || $from.parent.type.name !== "codeBlock" || $from.parentOffset !== 0) return false
  if (dispatch) {
    const { schema } = state
    const paragraphs = $from.parent.textContent
      .split("\n")
      .map((line) => schema.nodes.paragraph!.create(null, line ? schema.text(line) : null))
    const start = $from.before()
    const tr = state.tr.replaceWith(start, $from.after(), paragraphs)
    dispatch(tr.setSelection(TextSelection.create(tr.doc, start + 1)))
  }
  return true
}

const CODE_INDENT = "  "

function outdentLine(line: string): string {
  if (line.startsWith(CODE_INDENT)) return line.slice(CODE_INDENT.length)
  if (line.startsWith("\t")) return line.slice(1)
  if (line.startsWith(" ")) return line.slice(1)
  return line
}

export function indentInCode(state: EditorState, outdent: boolean, dispatch?: Dispatch): boolean {
  const block = codeBlockRange(state)
  if (!block) return false
  const { from, to } = state.selection
  if (from === to && !outdent) {
    dispatch?.(state.tr.insertText(CODE_INDENT, from, to).scrollIntoView())
    return true
  }
  const startOffset = from - block.from
  const endOffset = to - block.from
  const lineStart = block.text.lastIndexOf("\n", Math.max(0, startOffset - 1)) + 1
  const newline = block.text.indexOf("\n", Math.max(startOffset, endOffset - 1))
  const lineEnd = newline === -1 ? block.text.length : newline
  const lines = block.text.slice(lineStart, lineEnd).split("\n")
  const next = lines.map((line) => {
    if (line.length === 0) return line
    return outdent ? outdentLine(line) : `${CODE_INDENT}${line}`
  })
  if (next.join("\n") === lines.join("\n")) return true
  if (dispatch) {
    const transaction = state.tr.insertText(next.join("\n"), block.from + lineStart, block.from + lineEnd)
    const firstDelta = (next[0]?.length ?? 0) - (lines[0]?.length ?? 0)
    const totalDelta = next.join("\n").length - lines.join("\n").length
    const nextFrom = Math.max(block.from + lineStart, from + firstDelta)
    const nextTo = Math.max(nextFrom, to + totalDelta)
    transaction.setSelection(TextSelection.create(transaction.doc, nextFrom, nextTo))
    dispatch(transaction.scrollIntoView())
  }
  return true
}
