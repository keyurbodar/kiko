import { describe, expect, test } from "bun:test"
import { getSchema } from "@tiptap/core"
import { Blockquote } from "@tiptap/extension-blockquote"
import { Bold } from "@tiptap/extension-bold"
import { Code } from "@tiptap/extension-code"
import { CodeBlock } from "@tiptap/extension-code-block"
import { Document } from "@tiptap/extension-document"
import { HardBreak } from "@tiptap/extension-hard-break"
import { Heading } from "@tiptap/extension-heading"
import { HorizontalRule } from "@tiptap/extension-horizontal-rule"
import { Italic } from "@tiptap/extension-italic"
import { BulletList, ListItem, OrderedList } from "@tiptap/extension-list"
import { Paragraph } from "@tiptap/extension-paragraph"
import { Strike } from "@tiptap/extension-strike"
import { Text } from "@tiptap/extension-text"
import { EditorState, TextSelection } from "@tiptap/pm/state"
import { docToMarkdown, type Json } from "./markdown"
import { markdownSlice } from "./paste"
import { Link, Mention } from "./nodes"

const schema = getSchema([Document, Paragraph, Text, HardBreak, Bold, Italic, Strike, Code, Blockquote, Heading, HorizontalRule, CodeBlock, BulletList, OrderedList, ListItem, Link, Mention])

/** Pastes `text` with the caret at `caret` in `start`, and returns the resulting markdown. */
function paste(start: string, caret: number, text: string): string {
  const doc = schema.nodeFromJSON({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: start }] }] })
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1 + caret) })
  const next = state.apply(state.tr.replaceSelection(markdownSlice(schema, text)))
  return docToMarkdown(next.doc.toJSON() as Json)
}

describe("pasting plain text", () => {
  test("a line with no markdown lands inline", () => {
    expect(paste("ab", 1, "xyz")).toBe("axyzb")
  })

  test("pasted bold is bold, not asterisks", () => {
    const doc = schema.nodeFromJSON({ type: "doc", content: [{ type: "paragraph" }] })
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1) })
    const next = state.apply(state.tr.replaceSelection(markdownSlice(schema, "**bold**")))
    expect(next.doc.textContent).toBe("bold")
    expect(next.doc.firstChild?.firstChild?.marks.map((m) => m.type.name)).toEqual(["bold"])
  })

  test("a pasted list is a list, not dash lines", () => {
    const doc = schema.nodeFromJSON({ type: "doc", content: [{ type: "paragraph" }] })
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1) })
    const next = state.apply(state.tr.replaceSelection(markdownSlice(schema, "- one\n- two")))
    expect(next.doc.firstChild?.type.name).toBe("bulletList")
  })

  test("a blank line in the middle of a paragraph splits it, with the text kept", () => {
    expect(paste("ab", 1, "x\n\ny")).toBe("ax\n\nyb")
  })
})
