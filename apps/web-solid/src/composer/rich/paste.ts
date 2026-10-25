import { Fragment, Slice, type Node as PMNode, type Schema } from "@tiptap/pm/model"
import { markdownToDoc, type ParseOptions } from "./markdown"

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

const LONE_LINK = /^(?:https?:\/\/|www\.)\S+$/i

export const isLoneLink = (text: string): boolean => LONE_LINK.test(text.trim())
