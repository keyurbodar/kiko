import { SaxesParser, type SaxesTagNS } from "saxes"
import type { OfficeBlock, Slide } from "./office-model"

const attr = (tag: SaxesTagNS, local: string): string | undefined =>
  Object.values(tag.attributes).find((attribute) => attribute.local === local)?.value

export type SlideSource = { xml: string; relationships: Map<string, string> }

function slideBlocks(source: SlideSource): { blocks: OfficeBlock[]; title: string } {
  const parser = new SaxesParser({ xmlns: true })
  const blocks: OfficeBlock[] = []
  let paragraph: { text: string; bullet: boolean; title: boolean; images: string[] } | null = null
  let list: string[] | null = null
  let inText = 0
  let inTitleShape = 0
  let title = ""

  const flushList = () => {
    if (list?.length) blocks.push({ kind: "list", ordered: false, items: list })
    list = null
  }
  const finish = () => {
    if (!paragraph) return
    const current = paragraph
    paragraph = null
    const text = current.text.trim()
    const images = current.images.map((path): OfficeBlock => ({ kind: "image", path }))
    if (current.title && text && !title) title = text
    if (text && current.title) blocks.push({ kind: "heading", level: 1, text })
    else if (text && current.bullet) {
      list ??= []
      list.push(text)
    } else {
      flushList()
      if (text) blocks.push({ kind: "paragraph", text })
      blocks.push(...images)
      return
    }
    blocks.push(...images)
  }

  parser.on("opentag", (tag) => {
    switch (tag.local) {
      case "sp":
        inTitleShape = 0
        break
      case "ph":
        if (attr(tag, "type") === "title" || attr(tag, "type") === "ctrTitle") inTitleShape++
        break
      case "p":
        paragraph = { text: "", bullet: false, title: inTitleShape > 0, images: [] }
        break
      case "buChar":
      case "buAutoNum":
        if (paragraph) paragraph.bullet = true
        break
      case "t":
        inText++
        break
      case "br":
        if (paragraph) paragraph.text += "\n"
        break
      case "blip": {
        const target = source.relationships.get(attr(tag, "embed") ?? "")
        if (!target) break
        if (paragraph) paragraph.images.push(target)
        else {
          flushList()
          blocks.push({ kind: "image", path: target })
        }
        break
      }
    }
  })
  parser.on("text", (text) => {
    if (inText > 0 && paragraph) paragraph.text += text
  })
  parser.on("closetag", (tag) => {
    switch (tag.local) {
      case "t":
        inText = Math.max(0, inText - 1)
        break
      case "p":
        finish()
        break
      case "sp":
        inTitleShape = 0
        break
    }
  })
  parser.write(source.xml).close()
  flushList()
  return { blocks, title }
}

export function parsePptx(sources: readonly SlideSource[]): Slide[] {
  return sources.map((source, index) => {
    const { blocks, title } = slideBlocks(source)
    return { title: title || `Slide ${index + 1}`, blocks }
  })
}
