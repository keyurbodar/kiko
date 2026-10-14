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
import { backspaceAcrossList, bulletItemToTask, deleteAcrossList, exitCodeBlockOnClosingFence, exitCodeBlockOnTrailingBlankLines, indentInCode, indentedNewlineInCodeBlock, leaveEmptyQuote, openFenceOnEnter, shiftEnterInCode, splitOrLeaveListItem, unwrapCodeBlockAtStart } from "./keys"
import { Link, Mention } from "./nodes"

const ListItemWithMarker = ListItem.extend({ addAttributes: () => ({ marker: { default: "-", rendered: false } }) })

const FencedCodeBlock = CodeBlock.extend({
  addAttributes() {
    return { ...this.parent?.(), language: { default: "" }, fence: { default: "```" }, close: { default: "\n```" } }
  },
})

const schema = getSchema([Document, Paragraph, Text, HardBreak, Bold, Italic, Strike, Code.extend({ excludes: "code" }), Blockquote, FencedCodeBlock, BulletList, OrderedList, ListItemWithMarker, TaskList, TaskItem.configure({ nested: true }), Link, Mention])

type Json = { type: string; text?: string; attrs?: Record<string, unknown>; content?: Json[] }
const text = (value: string): Json => ({ type: "text", text: value })
const para = (value = ""): Json => (value ? { type: "paragraph", content: [text(value)] } : { type: "paragraph" })
const item = (value = ""): Json => ({ type: "listItem", content: [para(value)] })

function stateOf(...content: Json[]): EditorState {
  const doc: Node = schema.nodeFromJSON({ type: "doc", content })
  return EditorState.create({ doc, selection: Selection.atEnd(doc) })
}

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
    expect(doc?.child(0).attrs.fence).toBe("```")
    expect(doc?.child(0).attrs.close).toBe("\n```")
  })

  test("opens a tilde fence", () => {
    const doc = run(stateOf(para("~~~")), openFenceOnEnter)
    expect(doc?.child(0).attrs.fence).toBe("~~~")
  })

  test("a backtick line holding a backtick stays text", () => {
    expect(run(stateOf(para("``` a`b")), openFenceOnEnter)).toBeNull()
  })

  test("a plain line is left for Enter to send", () => {
    expect(run(stateOf(para("word")), openFenceOnEnter)).toBeNull()
  })
})

describe("Enter on a closing fence line", () => {
  const fence = (body: string): Json => ({ type: "codeBlock", attrs: { language: "", fence: "```", close: "" }, content: [text(body)] })

  test("ends the block and leaves a paragraph after it", () => {
    const doc = run(stateOf(fence("let a = 1\n```")), exitCodeBlockOnClosingFence)
    expect(doc?.child(0).type.name).toBe("codeBlock")
    expect(doc?.child(0).textContent).toBe("let a = 1")
    expect(doc?.child(0).attrs.close).toBe("\n```")
    expect(doc?.child(1).type.name).toBe("paragraph")
  })

  test("lines after the closing fence become paragraphs", () => {
    const doc = schema.nodeFromJSON({ type: "doc", content: [fence("let a = 1\n```\nafter")] })
    const caret = EditorState.create({ doc, selection: TextSelection.create(doc, 14) })
    const result = run(caret, exitCodeBlockOnClosingFence)
    expect(result?.childCount).toBe(3)
    expect(result?.child(2).textContent).toBe("after")
  })

  test("a fence line that is too short or the wrong mark is code", () => {
    expect(run(stateOf(fence("let a = 1\n``")), exitCodeBlockOnClosingFence)).toBeNull()
    expect(run(stateOf(fence("let a = 1\n~~~")), exitCodeBlockOnClosingFence)).toBeNull()
  })
})

describe("Enter at the end of an indented code line", () => {
  test("carries the indent onto the new line", () => {
    const doc = run(stateOf({ type: "codeBlock", content: [text("  word")] }), indentedNewlineInCodeBlock)
    expect(doc?.child(0).textContent).toBe("  word\n  ")
  })

  test("an unindented line gets the default newline", () => {
    expect(run(stateOf({ type: "codeBlock", content: [text("word")] }), indentedNewlineInCodeBlock)).toBeNull()
  })
})

describe("two blank lines at the end of a fence", () => {
  function runView(state: EditorState) {
    let next = state
    const view = { get state() { return next }, dispatch: (tr: Transaction) => { next = next.apply(tr) } }
    const handled = exitCodeBlockOnTrailingBlankLines(view as never)
    return handled ? next.doc : null
  }

  test("leave the fence for a paragraph after it", () => {
    const doc = runView(stateOf({ type: "codeBlock", attrs: { close: "" }, content: [text("let a = 1\n\n")] }))
    expect(doc?.child(0).type.name).toBe("codeBlock")
    expect(doc?.child(0).textContent).toBe("let a = 1")
    expect(doc?.child(0).attrs.close).toBe("\n```")
    expect(doc?.child(1)?.type.name).toBe("paragraph")
  })

  test("one blank line is still code", () => {
    expect(runView(stateOf({ type: "codeBlock", content: [text("let a = 1\n")] }))).toBeNull()
  })
})

describe("Backspace at the start of a fence", () => {
  test("unwraps the code into paragraphs and keeps the caret", () => {
    const doc = schema.nodeFromJSON({ type: "doc", content: [{ type: "codeBlock", content: [text("one\ntwo")] }] })
    const caret = EditorState.create({ doc, selection: TextSelection.create(doc, 1) })
    const result = run(caret, unwrapCodeBlockAtStart)
    expect(result?.childCount).toBe(2)
    expect(result?.child(0).type.name).toBe("paragraph")
    expect(result?.child(1).textContent).toBe("two")
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
    const caret = EditorState.create({ doc, selection: TextSelection.create(doc, 10) })
    const result = run(caret, backspaceAcrossList)
    expect(result?.child(0).childCount).toBe(2)
    expect(result?.child(0).child(1).textContent).toBe("two")
  })

  test("Backspace at the start of an item lifts it out of the top list", () => {
    const doc = schema.nodeFromJSON({ type: "doc", content: [{ type: "bulletList", content: [item("one"), item("two")] }] })
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
    const caret = EditorState.create({ doc, selection: TextSelection.create(doc, 6) })
    const result = run(caret, deleteAcrossList)
    expect(result?.child(0).childCount).toBe(1)
    expect(result?.child(0).textContent).toBe("onetwo")
  })
})

function stateAt(list: Json): EditorState {
  const doc = schema.nodeFromJSON({ type: "doc", content: [list] })
  return EditorState.create({ doc, selection: TextSelection.create(doc, 3 + (list.content?.[0]?.content?.[0]?.content?.[0]?.text?.length ?? 0)) })
}
