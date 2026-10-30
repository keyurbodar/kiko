import { SaxesParser, type SaxesTagNS } from "saxes"
import { headingLevel, type OfficeBlock } from "./office-model"

export type Numbering = Map<string, boolean>

type Paragraph = {
  text: string
  style: string
  outline: number | null
  numId: string | null
  ilvl: string
  images: string[]
}

type TableState = { rows: string[][]; row: string[]; cell: string[] }

const attr = (tag: SaxesTagNS, local: string): string | undefined =>
  Object.values(tag.attributes).find((attribute) => attribute.local === local)?.value

export function parseRelationships(xml: string, base: string): Map<string, string> {
  const targets = new Map<string, string>()
  for (const match of xml.matchAll(/<Relationship\b([^>]*)>/g)) {
    const body = match[1] ?? ""
    const id = /\bId="([^"]*)"/.exec(body)?.[1]
    const target = /\bTarget="([^"]*)"/.exec(body)?.[1]
    if (!id || !target || /^https?:/i.test(target)) continue
    targets.set(id, new URL(target, `https://office.invalid/${base}`).pathname.slice(1))
  }
  return targets
}

export function parseNumbering(xml: string): Numbering {
  const abstract = new Map<string, Map<string, boolean>>()
  for (const block of xml.matchAll(/<w:abstractNum\b([^>]*)>([\s\S]*?)<\/w:abstractNum>/g)) {
    const id = /\bw:abstractNumId="([^"]*)"/.exec(block[1] ?? "")?.[1]
    if (!id) continue
    const levels = new Map<string, boolean>()
    for (const level of (block[2] ?? "").matchAll(/<w:lvl\b([^>]*)>([\s\S]*?)<\/w:lvl>/g)) {
      const ilvl = /\bw:ilvl="([^"]*)"/.exec(level[1] ?? "")?.[1] ?? "0"
      const format = /<w:numFmt\b[^>]*\bw:val="([^"]*)"/.exec(level[2] ?? "")?.[1] ?? "bullet"
      levels.set(ilvl, format !== "bullet" && format !== "none")
    }
    abstract.set(id, levels)
  }
  const numbering: Numbering = new Map()
  for (const block of xml.matchAll(/<w:num\b([^>]*)>([\s\S]*?)<\/w:num>/g)) {
    const id = /\bw:numId="([^"]*)"/.exec(block[1] ?? "")?.[1]
    const source = /<w:abstractNumId\b[^>]*\bw:val="([^"]*)"/.exec(block[2] ?? "")?.[1]
    if (!id || !source) continue
    for (const [ilvl, ordered] of abstract.get(source) ?? []) numbering.set(`${id}:${ilvl}`, ordered)
  }
  return numbering
}

export function parseDocx(
  documentXml: string,
  relationships: Map<string, string>,
  numbering: Numbering,
): OfficeBlock[] {
  const parser = new SaxesParser({ xmlns: true })
  const blocks: OfficeBlock[] = []
  let paragraph: Paragraph | null = null
  let table: TableState | null = null
  let list: { ordered: boolean; items: string[] } | null = null
  let inText = 0

  const flushList = () => {
    if (list?.items.length) blocks.push({ kind: "list", ordered: list.ordered, items: list.items })
    list = null
  }

  const finishParagraph = () => {
    if (!paragraph) return
    const current = paragraph
    paragraph = null
    if (table) {
      table.cell.push(current.text.trim())
      return
    }
    const images = current.images.map((path): OfficeBlock => ({ kind: "image", path }))
    if (current.numId !== null) {
      const ordered = numbering.get(`${current.numId}:${current.ilvl}`) ?? false
      if (current.text.trim()) {
        if (!list || list.ordered !== ordered) {
          flushList()
          list = { ordered, items: [] }
        }
        list.items.push(current.text.trim())
      }
      blocks.push(...images)
      return
    }
    flushList()
    const text = current.text.trim()
    const level = headingLevel(current.style, current.outline)
    if (text && level !== null) blocks.push({ kind: "heading", level, text })
    else if (text) blocks.push({ kind: "paragraph", text })
    blocks.push(...images)
  }

  const openBlock = (tag: SaxesTagNS) => {
    switch (tag.local) {
      case "p":
        paragraph = { text: "", style: "", outline: null, numId: null, ilvl: "0", images: [] }
        break
      case "tbl":
        flushList()
        table = { rows: [], row: [], cell: [] }
        break
      case "tr":
        if (table) table.row = []
        break
      case "tc":
        if (table) table.cell = []
        break
    }
  }

  const openParagraph = (tag: SaxesTagNS) => {
    if (!paragraph) return
    switch (tag.local) {
      case "pStyle":
        paragraph.style = attr(tag, "val") ?? ""
        break
      case "outlineLvl":
        paragraph.outline = Number(attr(tag, "val"))
        break
      case "numId":
        paragraph.numId = attr(tag, "val") ?? null
        break
      case "ilvl":
        paragraph.ilvl = attr(tag, "val") ?? "0"
        break
      case "tab":
        paragraph.text += "\t"
        break
      case "br":
        paragraph.text += "\n"
        break
      case "blip": {
        const target = relationships.get(attr(tag, "embed") ?? "")
        if (target) paragraph.images.push(target)
        break
      }
    }
  }

  parser.on("opentag", (tag) => {
    openBlock(tag)
    openParagraph(tag)
    if (tag.local === "t") inText++
  })
  parser.on("text", (text) => {
    if (inText > 0 && paragraph) paragraph.text += text
  })
  const closeBlock = (tag: SaxesTagNS) => {
    switch (tag.local) {
      case "p":
        finishParagraph()
        break
      case "tc":
        if (table) {
          table.row.push(table.cell.join("\n"))
          table.cell = []
        }
        break
      case "tr":
        if (table) {
          table.rows.push(table.row)
          table.row = []
        }
        break
      case "tbl":
        if (table) {
          flushList()
          blocks.push({ kind: "table", rows: table.rows })
          table = null
        }
        break
    }
  }

  parser.on("closetag", (tag) => {
    if (tag.local === "t") inText = Math.max(0, inText - 1)
    closeBlock(tag)
  })
  parser.write(documentXml).close()
  flushList()
  return blocks
}
