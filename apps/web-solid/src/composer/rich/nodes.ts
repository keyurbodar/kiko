import { fileName } from "@kiko/protocol"
import { Mark, mergeAttributes, Node } from "@tiptap/core"
import "../../lib/chip.css"

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

let fresh = false

export function popNextToken() {
  fresh = true
}

export type TokenView = (dom: HTMLElement, token: { sign: "@" | "/"; name: string }) => () => void

function tokenNodeView(view: TokenView, sign: "@" | "/", name: string) {
  const dom = document.createElement("span")
  dom.className = "composer-chip-node"
  dom.contentEditable = "false"
  if (sign === "@") dom.dataset.mention = name
  else dom.dataset.slash = name
  if (fresh) {
    dom.dataset.fresh = ""
    fresh = false
  }
  const dispose = view(dom, { sign, name })
  return { dom, ignoreMutation: () => true, destroy: dispose }
}

export function mentionExtension(view: TokenView) {
  return Node.create({
    name: "mention",
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    draggable: false,
    addAttributes: () => ({ slug: { default: "" } }),
    parseHTML: () => [{ tag: "span[data-mention]", getAttrs: (dom) => ({ slug: dom.getAttribute("data-mention") }) }],
    renderHTML: ({ node }) => ["span", { "data-mention": String(node.attrs.slug) }, `@${node.attrs.slug}`],
    renderText: ({ node }) => `@${node.attrs.slug}`,
    addNodeView:
      () =>
      ({ node }) =>
        tokenNodeView(view, "@", String(node.attrs.slug)),
  })
}

export function slashExtension(view: TokenView) {
  return Node.create({
    name: "slash",
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    draggable: false,
    addAttributes: () => ({ name: { default: "" } }),
    parseHTML: () => [{ tag: "span[data-slash]", getAttrs: (dom) => ({ name: dom.getAttribute("data-slash") }) }],
    renderHTML: ({ node }) => ["span", { "data-slash": String(node.attrs.name) }, `/${node.attrs.name}`],
    renderText: ({ node }) => `/${node.attrs.name}`,
    addNodeView:
      () =>
      ({ node }) =>
        tokenNodeView(view, "/", String(node.attrs.name)),
  })
}

export const CHIP_NODES = new Set(["mention", "slash", "fileRef", "attachment"])

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
        if (fresh) {
          dom.dataset.fresh = ""
          fresh = false
        }
        const dispose = view(dom, { path: String(node.attrs.path), folder: Boolean(node.attrs.folder) })
        return { dom, ignoreMutation: () => true, destroy: dispose }
      },
  })
}
