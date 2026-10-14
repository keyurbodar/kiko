import { Fragment, Slice, type Node as PMNode, type Schema } from "@tiptap/pm/model"
import { markdownToDoc, type ParseOptions } from "./markdown"

/**
 * The slice a paste of plain text inserts. The text is read as the composer reads
 * its own source, so pasted `**bold**`, lists and headings show as they will be
 * sent. A first or last paragraph opens into the caret's line, so a paste with no
 * blank lines lands inline, the way plain text does.
 */
export function markdownSlice(schema: Schema, text: string, options: ParseOptions = {}): Slice {
  const doc = schema.nodeFromJSON(markdownToDoc(text, options))
  const nodes: PMNode[] = []
  doc.forEach((node) => nodes.push(node))
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  return new Slice(
    Fragment.fromArray(nodes),
    first?.type.name === "paragraph" ? 1 : 0,
    last?.type.name === "paragraph" ? 1 : 0,
  )
}
