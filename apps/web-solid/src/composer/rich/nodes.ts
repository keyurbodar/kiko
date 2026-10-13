import { Mark, mergeAttributes, Node } from "@tiptap/core"
import { FileTextIcon } from "@kiko/ui/icons"
import { identityLook } from "../../lib/identity"

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
    { "data-mention": String(node.attrs.slug), style: `color:${identityLook(String(node.attrs.slug)).color}` },
    `@${node.attrs.slug}`,
  ],
  renderText: ({ node }) => `@${node.attrs.slug}`,
})

export type ChipStatus = { state: "uploading" | "failed" | "ready"; label?: string; reason?: string }

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

export function chipExtension(onAction: (id: string) => void) {
  return Node.create({
    name: "fileChip",
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    draggable: false,
    addAttributes: () => ({ id: { default: "" }, name: { default: "" } }),
    parseHTML: () => [{ tag: "span[data-chip-id]" }],
    renderHTML: ({ node }) => ["span", { "data-chip-id": String(node.attrs.id) }, String(node.attrs.name)],
    renderText: () => "",
    addNodeView: () => ({ node }) => {
      const dom = document.createElement("span")
      dom.className = "composer-chip"
      dom.contentEditable = "false"
      dom.dataset.chipId = String(node.attrs.id)
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
      icon.setAttribute("viewBox", "0 0 24 24")
      icon.setAttribute("aria-hidden", "true")
      icon.innerHTML = FileTextIcon
      const name = document.createElement("span")
      name.className = "composer-chip-name"
      name.textContent = middleTruncate(String(node.attrs.name))
      name.title = String(node.attrs.name)
      const status = document.createElement("span")
      status.className = "composer-chip-status"
      dom.append(icon, name, status)
      dom.addEventListener("click", () => {
        if (dom.dataset.state === "failed") onAction(String(node.attrs.id))
      })
      return { dom, ignoreMutation: () => true }
    },
  })
}

export function setChipStatus(root: HTMLElement, id: string, status: ChipStatus) {
  const chip = root.querySelector<HTMLElement>(`[data-chip-id="${CSS.escape(id)}"]`)
  if (!chip) return
  chip.dataset.state = status.state
  const label = chip.querySelector<HTMLElement>(".composer-chip-status")
  if (label) label.textContent = status.state === "failed" ? "Retry" : (status.label ?? "")
  chip.title = status.state === "failed" ? (status.reason ?? "Upload failed") : ""
}
