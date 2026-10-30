import JSZip from "jszip"
import { xlsxSheets } from "../preview/xlsx"
import {
  MAX_SHEETS,
  MAX_SLIDES,
  OFFICE_MAX_BYTES,
  imageType,
  type OfficeImage,
  type OfficeModel,
  type OfficeRequest,
  type OfficeResult,
} from "./office-model"
import { parseDocx, parseNumbering, parseRelationships } from "./office-docx"
import { parsePptx, type SlideSource } from "./office-pptx"

const MAX_IMAGES = 64
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_DOCX_BLOCKS = 20_000

const post = (value: OfficeResult) =>
  (self as unknown as { postMessage: (value: unknown, transfer: Transferable[]) => void }).postMessage(value, [])

async function text(zip: JSZip, path: string): Promise<string> {
  const entry = zip.file(path)
  return entry ? entry.async("string") : ""
}

async function images(zip: JSZip, prefix: string): Promise<OfficeImage[]> {
  const found: OfficeImage[] = []
  for (const name of Object.keys(zip.files).sort()) {
    if (found.length >= MAX_IMAGES) break
    if (!name.startsWith(prefix) || !imageType(name)) continue
    const entry = zip.file(name)
    if (!entry || entry.dir) continue
    const bytes = await entry.async("uint8array")
    if (bytes.byteLength > MAX_IMAGE_BYTES) continue
    found.push({ path: name, type: imageType(name)!, bytes })
  }
  return found
}

async function pptxSources(zip: JSZip): Promise<SlideSource[]> {
  const presentation = await text(zip, "ppt/presentation.xml")
  const relationships = parseRelationships(await text(zip, "ppt/_rels/presentation.xml.rels"), "ppt/")
  const ordered: string[] = []
  for (const tag of presentation.matchAll(/<p:sldId\b([^>]*)>/g)) {
    const id = /\br:id="([^"]*)"/.exec(tag[1] ?? "")?.[1]
    const target = id ? relationships.get(id) : undefined
    if (target && zip.file(target)) ordered.push(target)
  }
  const paths = ordered.length
    ? ordered
    : Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((left, right) => Number(/(\d+)\.xml$/.exec(left)?.[1]) - Number(/(\d+)\.xml$/.exec(right)?.[1]))
  return Promise.all(
    paths.slice(0, MAX_SLIDES).map(async (path) => ({
      xml: await text(zip, path),
      relationships: parseRelationships(
        await text(zip, path.replace(/^ppt\//, "ppt/slides/_rels/") + ".rels"),
        "ppt/slides/",
      ),
    })),
  )
}

async function open(input: OfficeRequest): Promise<OfficeModel> {
  const response = await fetch(input.src, { cache: "no-store" })
  if (!response.ok) throw new Error("This file could not be loaded.")
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > OFFICE_MAX_BYTES) throw new Error("Preview limited to files under 25 MB.")
  if (input.kind === "xlsx") {
    const sheets = await xlsxSheets(bytes, { rows: 1000, columns: 64, cell: 512, sheets: MAX_SHEETS })
    return { kind: "xlsx", sheets, truncated: sheets.some((sheet) => sheet.truncated) || sheets.length >= MAX_SHEETS }
  }
  const zip = await JSZip.loadAsync(bytes)
  if (input.kind === "docx") {
    const blocks = parseDocx(
      await text(zip, "word/document.xml"),
      parseRelationships(await text(zip, "word/_rels/document.xml.rels"), "word/"),
      parseNumbering(await text(zip, "word/numbering.xml")),
    )
    return {
      kind: "docx",
      blocks: blocks.slice(0, MAX_DOCX_BLOCKS),
      images: await images(zip, "word/media/"),
      truncated: blocks.length > MAX_DOCX_BLOCKS,
    }
  }
  const sources = await pptxSources(zip)
  if (!sources.length) throw new Error("This presentation has no slides.")
  return {
    kind: "pptx",
    slides: parsePptx(sources),
    images: await images(zip, "ppt/media/"),
    truncated: sources.length >= MAX_SLIDES,
  }
}

self.addEventListener("message", (event: MessageEvent<OfficeRequest>) => {
  void open(event.data).then(
    (model) => post({ type: "model", model }),
    (cause: unknown) =>
      post({ type: "error", message: cause instanceof Error ? cause.message : "Could not read this document." }),
  )
})
