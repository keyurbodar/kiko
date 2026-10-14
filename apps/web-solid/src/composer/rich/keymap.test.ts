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
import { BINDINGS, LINK_KEY } from "./keymap"
import { docToMarkdown, markdownToDoc, type Json } from "./markdown"
import { Link, Mention } from "./nodes"

const schema = getSchema([Document, Paragraph, Text, HardBreak, Bold, Italic, Strike, Code, Blockquote, CodeBlock, BulletList, OrderedList, ListItem, Link, Mention])

function press(key: string, markdown: string): string {
  const binding = BINDINGS.find((b) => b.key === key)
  if (!binding) throw new Error(`no binding for ${key}`)
  const doc: Node = schema.nodeFromJSON(markdownToDoc(markdown))
  let state = EditorState.create({ doc })
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, Selection.atEnd(state.doc).to)))
  let next: Transaction | undefined
  const ran = binding.command(schema)(state, (tr) => (next = tr))
  expect(ran).toBe(true)
  return docToMarkdown((next ? state.apply(next) : state).doc.toJSON() as Json)
}

const table: { key: string; label: string; markdown: string; expected: string }[] = [
  { key: "Mod-b", label: "bold", markdown: "word", expected: "**word**" },
  { key: "Mod-i", label: "italic", markdown: "word", expected: "*word*" },
  { key: "Mod-Shift-s", label: "strikethrough", markdown: "word", expected: "~~word~~" },
  { key: "Mod-e", label: "inline code", markdown: "word", expected: "`word`" },
]

describe("the formatting keys", () => {
  for (const row of table) {
    test(`${row.key} turns ${row.label} on`, () => {
      expect(press(row.key, row.markdown)).toBe(row.expected)
    })
  }

  test("each mark key turns its mark off again", () => {
    expect(press("Mod-b", "**word**")).toBe("word")
    expect(press("Mod-i", "*word*")).toBe("word")
    expect(press("Mod-Shift-s", "~~word~~")).toBe("word")
    expect(press("Mod-e", "`word`")).toBe("word")
  })

  test("the keymap holds only t3code's mark chords, and each has a row in the table", () => {
    expect(BINDINGS.map((b) => b.key).sort()).toEqual(table.map((r) => r.key).sort())
    expect(BINDINGS.map((b) => b.label)).toEqual(table.map((r) => r.label))
  })

  test("the block chords t3code removes are gone", () => {
    expect(BINDINGS.map((b) => b.key)).not.toContain("Mod-Shift-8")
    expect(BINDINGS.map((b) => b.key)).not.toContain("Mod-Shift-7")
    expect(BINDINGS.map((b) => b.key)).not.toContain("Mod-Shift-b")
    expect(BINDINGS.map((b) => b.key)).not.toContain("Mod-Alt-c")
  })

  test("Mod+K is the link key, kept apart from the formatting table", () => {
    expect(LINK_KEY).toBe("Mod-k")
    expect(BINDINGS.map((b) => b.key)).not.toContain(LINK_KEY)
  })
})
