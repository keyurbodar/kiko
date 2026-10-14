import { describe, expect, test } from "bun:test"
import { getSchema } from "@tiptap/core"
import { Blockquote } from "@tiptap/extension-blockquote"
import { Bold } from "@tiptap/extension-bold"
import { Code } from "@tiptap/extension-code"
import { CodeBlock } from "@tiptap/extension-code-block"
import { Document } from "@tiptap/extension-document"
import { HardBreak } from "@tiptap/extension-hard-break"
import { Italic } from "@tiptap/extension-italic"
import { BulletList, ListItem, OrderedList } from "@tiptap/extension-list"
import { Paragraph } from "@tiptap/extension-paragraph"
import { Strike } from "@tiptap/extension-strike"
import { Text } from "@tiptap/extension-text"
import type { Node } from "@tiptap/pm/model"
import { EditorState, Selection, TextSelection, type Transaction } from "@tiptap/pm/state"
import { TaskItem } from "@tiptap/extension-task-item"
import { TaskList } from "@tiptap/extension-task-list"
import { backspaceAcrossList, bulletItemToTask, deleteAcrossList, indentInCode, leaveEmptyQuote, openFenceOnEnter, shiftEnterInCode, splitOrLeaveListItem } from "./keys"
import { Link, Mention } from "./nodes"

// The composer's list item carries the marker it was typed with, as editor.ts declares it.
const ListItemWithMarker = ListItem.extend({ addAttributes: () => ({ marker: { default: "-", rendered: false } }) })

const schema = getSchema([Document, Paragraph, Text, HardBreak, Bold, Italic, Strike, Code.extend({ excludes: "code" }), Blockquote, CodeBlock, BulletList, OrderedList, ListItemWithMarker, TaskList, TaskItem.configure({ nested: true }), Link, Mention])

type Json = { type: string; text?: string; attrs?: Record<string, unknown>; content?: Json[] }
const text = (value: string): Json => ({ type: "text", text: value })
const para = (value = ""): Json => (value ? { type: "paragraph", content: [text(value)] } : { type: "paragraph" })
const item = (value = ""): Json => ({ type: "listItem", content: [para(value)] })

/** A document with the caret at its end, the place a typist is. */
function stateOf(...content: Json[]): EditorState {
  const doc: Node = schema.nodeFromJSON({ type: "doc", content })
  return EditorState.create({ doc, selection: Selection.atEnd(doc) })
}

/** Runs a command and returns the resulting document, or null when it did not run. */
function run(state: EditorState, command: (s: EditorState, d?: (tr: Transaction) => void) => boolean): Node | null {
  let next: Transaction | undefined
  if (!command(state, (tr) => (next = tr))) return null
  return (next ? state.apply(next) : state).doc
}

describe("Shift+Enter in a list", () => {
  test("a filled item splits into a new item", () => {
    const doc = run(stateOf({ type: "bulletList", content: [item("one")] }), splitOrLeaveListItem)
    expect(doc?.child(0).childCount).toBe(2)
  })

  test("an empty item leaves the list for a paragraph", () => {
    const doc = run(stateOf({ type: "bulletList", content: [item("one"), item()] }), splitOrLeaveListItem)
    expect(doc?.child(0).childCount).toBe(1)
    expect(doc?.child(1).type.name).toBe("paragraph")
  })

  test("outside a list it does nothing, so the hard break runs", () => {
    expect(run(stateOf(para("word")), splitOrLeaveListItem)).toBeNull()
  })
})

describe("Shift+Enter in a quote", () => {
  test("an empty line of a quote leaves the quote", () => {
    const doc = run(stateOf({ type: "blockquote", content: [para("one"), para()] }), leaveEmptyQuote)
    expect(doc?.child(0).type.name).toBe("blockquote")
    expect(doc?.child(0).childCount).toBe(1)
    expect(doc?.child(1).type.name).toBe("paragraph")
  })

  test("the empty line after a Shift+Enter in a quote leaves the quote", () => {
    const line: Json = { type: "paragraph", content: [text("one"), { type: "hardBreak" }] }
    const doc = run(stateOf({ type: "blockquote", content: [line] }), leaveEmptyQuote)
    expect(doc?.child(0).type.name).toBe("blockquote")
    expect(doc?.child(0).textContent).toBe("one")
    expect(doc?.child(1).type.name).toBe("paragraph")
    expect(doc?.child(1).textContent).toBe("")
  })

  test("a filled line of a quote stays in it", () => {
    expect(run(stateOf({ type: "blockquote", content: [para("one")] }), leaveEmptyQuote)).toBeNull()
  })
})

describe("Shift+Enter in a fence", () => {
  test("inserts a line of code", () => {
    const doc = run(stateOf({ type: "codeBlock", content: [text("word")] }), shiftEnterInCode)
    expect(doc?.child(0).textContent).toBe("word\n")
  })
})

describe("Enter on a line of backticks", () => {
  test("opens a fence with its language", () => {
    const doc = run(stateOf(para("```ts")), openFenceOnEnter)
    expect(doc?.child(0).type.name).toBe("codeBlock")
    expect(doc?.child(0).attrs.language).toBe("ts")
  })

  test("a plain line is left for Enter to send", () => {
    expect(run(stateOf(para("word")), openFenceOnEnter)).toBeNull()
  })
})

describe("Tab in a fence", () => {
  test("a caret indents two spaces in place", () => {
    const state = stateOf({ type: "codeBlock", content: [text("word")] })
    const caret = EditorState.create({ doc: state.doc, selection: TextSelection.create(state.doc, 1) })
    expect(run(caret, (s, d) => indentInCode(s, false, d))?.child(0).textContent).toBe("  word")
  })

  test("Shift+Tab takes one indent back off the line", () => {
    const state = stateOf({ type: "codeBlock", content: [text("  word")] })
    const caret = EditorState.create({ doc: state.doc, selection: TextSelection.create(state.doc, 1) })
    expect(run(caret, (s, d) => indentInCode(s, true, d))?.child(0).textContent).toBe("word")
  })

  test("outside a fence it does nothing, so Tab keeps its focus behavior", () => {
    expect(run(stateOf(para("word")), (s, d) => indentInCode(s, false, d))).toBeNull()
  })
})

describe("code inside emphasis", () => {
  test("bold and code can share a run, as the editor's code mark allows", () => {
    const doc: Node = schema.nodeFromJSON({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "bold" }, { type: "code" }] }] }],
    })
    expect(doc.child(0).firstChild?.marks.map((m) => m.type.name).sort()).toEqual(["bold", "code"])
  })
})

describe("ordered markers on Shift+Enter", () => {
  const ordered = (...markers: string[]): Json => ({
    type: "orderedList",
    attrs: { start: 1 },
    content: markers.map((marker, index) => ({ type: "listItem", attrs: { marker }, content: [para(`item ${index}`)] })),
  })
  const markersOf = (doc: Node | null) => {
    const list = doc?.child(0)
    const found: string[] = []
    list?.forEach((child) => found.push(String(child.attrs.marker)))
    return found
  }

  test("a new line counts on from the item it came from, keeping the delimiter", () => {
    const state = stateAt(ordered("3)"))
    expect(markersOf(run(state, splitOrLeaveListItem))).toEqual(["3)", "4)"])
  })

  test("a split in the middle pushes the items after it down, so no number repeats", () => {
    const state = stateAt(ordered("1.", "2.", "3."))
    expect(markersOf(run(state, splitOrLeaveListItem))).toEqual(["1.", "2.", "3.", "4."])
  })

  test("a padded number keeps its width", () => {
    const state = stateAt(ordered("09."))
    expect(markersOf(run(state, splitOrLeaveListItem))).toEqual(["09.", "10."])
  })

  test("a bullet's new line copies the bullet", () => {
    const state = stateOf({ type: "bulletList", content: [{ type: "listItem", attrs: { marker: "*" }, content: [para("one")] }] })
    const doc = run(state, splitOrLeaveListItem)
    expect(doc?.child(0).child(1).attrs.marker).toBe("*")
  })
})

describe("task items on Shift+Enter", () => {
  test("a new task starts unchecked, even after a checked one", () => {
    const state = stateOf({ type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [para("done")] }] })
    expect(run(state, splitOrLeaveListItem)?.child(0).child(1).attrs.checked).toBe(false)
  })
})

describe("`[ ] ` on a bullet item", () => {
  test("turns the item into a task, with the caret in its text", () => {
    const doc = stateOf({ type: "bulletList", content: [{ type: "listItem", attrs: { marker: "-" }, content: [para("[ ] task")] }] }).doc
    // Positions: the list opens at 0, the item at 1, the paragraph at 2, its text starts at 3.
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 3, 7) })
    let next: Transaction | undefined
    bulletItemToTask(state.tr.setSelection(TextSelection.create(state.doc, 3, 7)), 3, 7, true)
    const tr = state.tr
    bulletItemToTask(tr, 3, 7, true)
    next = tr
    const result = state.apply(next).doc
    expect(result.child(0).type.name).toBe("taskList")
    expect(result.child(0).child(0).attrs.checked).toBe(true)
    expect(result.child(0).textContent).toBe("task")
  })

  test("a bullet split around the task keeps the bullets before and after it", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [{ type: "bulletList", content: [item("one"), { type: "listItem", attrs: { marker: "-" }, content: [para("[ ] two")] }, item("three")] }],
    })
    const state = EditorState.create({ doc, selection: Selection.atStart(doc) })
    // The item "two" starts after "one": list 0, item one 1..., compute from the doc.
    let at = 0
    doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.textContent === "[ ] two") at = pos + 1
    })
    const tr = state.tr
    bulletItemToTask(tr, at, at + 4, false)
    const result = state.apply(tr).doc
    expect(result.child(0).type.name).toBe("bulletList")
    expect(result.child(1).type.name).toBe("taskList")
    expect(result.child(2).type.name).toBe("bulletList")
    expect(result.child(1).textContent).toBe("two")
  })
})

describe("Backspace and Delete across a list", () => {
  test("Backspace at the start of a nested item lifts it one level", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [{ type: "bulletList", content: [{ type: "listItem", attrs: { marker: "-" }, content: [para("one"), { type: "bulletList", content: [item("two")] }] }] }],
    })
    // "one" fills 3 to 6 and its paragraph closes at 7, so the nested list opens at 7 and its paragraph's text starts at 10.
    const caret = EditorState.create({ doc, selection: TextSelection.create(doc, 10) })
    const result = run(caret, backspaceAcrossList)
    expect(result?.child(0).childCount).toBe(2)
    expect(result?.child(0).child(1).textContent).toBe("two")
  })

  test("Backspace at the start of an item lifts it out of the top list", () => {
    const doc = schema.nodeFromJSON({ type: "doc", content: [{ type: "bulletList", content: [item("one"), item("two")] }] })
    // "one" closes its paragraph at 7 and its item at 8, so "two" starts at 10.
    const caret = EditorState.create({ doc, selection: TextSelection.create(doc, 10) })
    const result = run(caret, backspaceAcrossList)
    expect(result?.child(0).textContent).toBe("one")
    expect(result?.child(1).type.name).toBe("paragraph")
    expect(result?.child(1).textContent).toBe("two")
  })

  test("Backspace in the middle of an item's text is left to the default", () => {
    const doc = schema.nodeFromJSON({ type: "doc", content: [{ type: "bulletList", content: [item("one")] }] })
    const caret = EditorState.create({ doc, selection: TextSelection.create(doc, 4) })
    expect(run(caret, backspaceAcrossList)).toBeNull()
  })

  test("Delete at the end of an item joins the next item's text onto it", () => {
    const doc = schema.nodeFromJSON({ type: "doc", content: [{ type: "bulletList", content: [item("one"), item("two")] }] })
    // The end of "one": list 0, item 1, paragraph 2, text 3..6, so the caret is at 6.
    const caret = EditorState.create({ doc, selection: TextSelection.create(doc, 6) })
    const result = run(caret, deleteAcrossList)
    expect(result?.child(0).childCount).toBe(1)
    expect(result?.child(0).textContent).toBe("onetwo")
  })
})

/** The caret at the end of the first item's text, where a typist presses Shift+Enter. */
function stateAt(list: Json): EditorState {
  const doc = schema.nodeFromJSON({ type: "doc", content: [list] })
  // The list opens at 0, its item at 1, the paragraph at 2, so the text starts at 3.
  return EditorState.create({ doc, selection: TextSelection.create(doc, 3 + (list.content?.[0]?.content?.[0]?.content?.[0]?.text?.length ?? 0)) })
}
