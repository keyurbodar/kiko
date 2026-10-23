import { fileName } from "@kiko/protocol"
import { Mark, mergeAttributes, Node } from "@tiptap/core"
import "../../lib/chip.css"
import { identityLook, identityTint } from "../../lib/identity"

export const Link = Mark.create({
  name: "link",
  inclusive: false,
  addAttributes: () => ({ href: { default: null } }),
  parseHTML: () => [{ tag: "a[href]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "a",
    mergeAttributes(HTMLAttributes, { rel: "noopener noreferrer nofollow" }),
    0,
  ],
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
    {
      "data-mention": String(node.attrs.slug),
      style: `color:${identityLook(String(node.attrs.slug)).color};background:${identityTint(String(node.attrs.slug), 16)}`,
    },
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

export type ChipView = (dom: HTMLElement, attachment: { id: string; name: string }) => () => void

export function attachmentExtension(view: ChipView) {
  return Node.create({
    name: "attachment",
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    draggable: false,
    addAttributes: () => ({ id: { default: "" }, name: { default: "" } }),
    parseHTML: () => [{ tag: "span[data-attachment]" }],
    renderHTML: ({ node }) => ["span", { "data-attachment": String(node.attrs.id) }, String(node.attrs.name)],
    renderText: ({ node }) => String(node.attrs.name),
    addNodeView:
      () =>
      ({ node }) => {
        const dom = document.createElement("span")
        dom.className = "composer-chip-node"
        dom.contentEditable = "false"
        dom.dataset.attachment = String(node.attrs.id)
        const dispose = view(dom, { id: String(node.attrs.id), name: String(node.attrs.name) })
        return {
          dom,
          ignoreMutation: () => true,
          stopEvent: (event) => event.target instanceof Element && event.target.closest("button") !== null,
          destroy: dispose,
        }
      },
  })
}

export type FileRefView = (dom: HTMLElement, ref: { path: string; folder: boolean }) => () => void

export function fileRefExtension(view: FileRefView) {
  return Node.create({
    name: "fileRef",
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    draggable: false,
    addAttributes: () => ({ path: { default: "" }, folder: { default: false } }),
    parseHTML: () => [{ tag: "span[data-file-ref]" }],
    renderHTML: ({ node }) => ["span", { "data-file-ref": String(node.attrs.path) }, fileName(String(node.attrs.path))],
    renderText: ({ node }) => fileName(String(node.attrs.path)),
    addNodeView:
      () =>
      ({ node }) => {
        const dom = document.createElement("span")
        dom.className = "composer-chip-node"
        dom.contentEditable = "false"
        dom.dataset.fileRef = String(node.attrs.path)
        const dispose = view(dom, { path: String(node.attrs.path), folder: Boolean(node.attrs.folder) })
        return { dom, ignoreMutation: () => true, destroy: dispose }
      },
  })
}
