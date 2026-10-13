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
import { BINDINGS } from "./keymap"
import { docToMarkdown, markdownToDoc, type Json } from "./markdown"
import { Link, Mention } from "./nodes"

const schema = getSchema([Document, Paragraph, Text, HardBreak, Bold, Italic, Strike, Code, Blockquote, CodeBlock, BulletList, OrderedList, ListItem, Link, Mention])

function press(key: string, markdown: string, select: "all" | "caret"): string {
  const binding = BINDINGS.find((b) => b.key === key)
  if (!binding) throw new Error(`no binding for ${key}`)
  const doc: Node = schema.nodeFromJSON(markdownToDoc(markdown))
  let state = EditorState.create({ doc })
  const start = Selection.atStart(state.doc).from
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, start, select === "all" ? Selection.atEnd(state.doc).to : start)))
  let next: Transaction | undefined
  const ran = binding.command(schema)(state, (tr) => (next = tr))
  expect(ran).toBe(true)
  return docToMarkdown((next ? state.apply(next) : state).doc.toJSON() as Json)
}

const table: { key: string; label: string; markdown: string; select: "all" | "caret"; expected: string }[] = [
  { key: "Mod-b", label: "bold", markdown: "word", select: "all", expected: "**word**" },
  { key: "Mod-i", label: "italic", markdown: "word", select: "all", expected: "*word*" },
  { key: "Mod-Shift-x", label: "strikethrough", markdown: "word", select: "all", expected: "~~word~~" },
  { key: "Mod-e", label: "inline code", markdown: "word", select: "all", expected: "`word`" },
  { key: "Mod-Shift-8", label: "bullet list", markdown: "word", select: "caret", expected: "- word" },
  { key: "Mod-Shift-7", label: "numbered list", markdown: "word", select: "caret", expected: "1. word" },
  { key: "Mod-Shift-b", label: "quote", markdown: "word", select: "caret", expected: "> word" },
  { key: "Mod-Alt-c", label: "code block", markdown: "word", select: "caret", expected: "```\nword\n```" },
]

describe("the formatting keys", () => {
  for (const row of table) {
    test(`${row.key} turns ${row.label} on`, () => {
      expect(press(row.key, row.markdown, row.select)).toBe(row.expected)
    })
  }

  test("every chord in the keymap has a row in the table", () => {
    expect(BINDINGS.map((b) => b.key).sort()).toEqual(table.map((r) => r.key).sort())
    expect(BINDINGS.map((b) => b.label)).toEqual(table.map((r) => r.label))
  })

  const off: [string, string, "all" | "caret", string][] = [
    ["Mod-b", "**word**", "all", "word"],
    ["Mod-i", "*word*", "all", "word"],
    ["Mod-Shift-x", "~~word~~", "all", "word"],
    ["Mod-e", "`word`", "all", "word"],
    ["Mod-Shift-8", "- word", "caret", "word"],
    ["Mod-Shift-7", "1. word", "caret", "word"],
    ["Mod-Shift-b", "> word", "caret", "word"],
    ["Mod-Alt-c", "```\nword\n```", "caret", "word"],
  ]
  for (const [key, from, select, expected] of off) {
    test(`${key} turns it off again`, () => {
      expect(press(key, from, select)).toBe(expected)
    })
  }

  test("a bullet list becomes a numbered list under the numbered list key", () => {
    expect(press("Mod-Shift-7", "- word", "caret")).toBe("1. word")
  })
})
