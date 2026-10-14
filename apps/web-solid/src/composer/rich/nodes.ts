import { Mark, mergeAttributes, Node } from "@tiptap/core"
import "../../lib/chip.css"
import { identityLook, identityTint } from "../../lib/identity"

export const Link = Mark.create({
  name: "link",
  inclusive: false,
  addAttributes: () => ({ href: { default: null } }),
  parseHTML: () => [{ tag: "a[href]" }],
  renderHTML: ({ HTMLAttributes }) => ["a", mergeAttributes(HTMLAttributes, { rel: "noopener noreferrer nofollow" }), 0],
})

export const Mention = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes: () => ({ slug: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-mention]" }],
  renderHTML: ({ node }) => [
    "span",
    { "data-mention": String(node.attrs.slug), style: `color:${identityLook(String(node.attrs.slug)).color};background:${identityTint(String(node.attrs.slug), 16)}` },
    `@${node.attrs.slug}`,
  ],
  renderText: ({ node }) => `@${node.attrs.slug}`,
})

export function middleTruncate(name: string, max = 36): string {
  if (name.length <= max) return name
  const dot = name.lastIndexOf(".")
  const extension = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : ""
  const room = max - extension.length - 1
  const head = Math.ceil(room * 0.6)
  const tail = room - head
  const stem = name.slice(0, name.length - extension.length)
  return `${stem.slice(0, head)}…${tail > 0 ? stem.slice(-tail) : ""}${extension}`
}
