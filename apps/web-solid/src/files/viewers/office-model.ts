export const OFFICE_MAX_BYTES = 25 * 1024 * 1024
export const MAX_SLIDES = 400
export const MAX_SHEETS = 24

export type OfficeImage = { path: string; type: string; bytes: Uint8Array }

export type OfficeBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; rows: string[][] }
  | { kind: "image"; path: string }

export type DocxModel = { kind: "docx"; blocks: OfficeBlock[]; images: OfficeImage[]; truncated: boolean }

export type Slide = { title: string; blocks: OfficeBlock[] }

export type PptxModel = { kind: "pptx"; slides: Slide[]; images: OfficeImage[]; truncated: boolean }

export type SheetModel = { name: string; rows: string[][]; truncated: boolean }

export type XlsxModel = { kind: "xlsx"; sheets: SheetModel[]; truncated: boolean }

export type OfficeModel = DocxModel | PptxModel | XlsxModel

export type OfficeKind = OfficeModel["kind"]

export type OfficeRequest = { type: "open"; kind: OfficeKind; src: string; size: number }

export type OfficeResult = { type: "model"; model: OfficeModel } | { type: "error"; message: string }

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
}

export function imageType(path: string): string | null {
  return IMAGE_TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? null
}

export function headingLevel(style: string, outline: number | null): number | null {
  const named = /^heading\s*([1-6])$/i.exec(style) ?? /^heading([1-6])$/i.exec(style)
  if (named?.[1]) return Number(named[1])
  if (/^title$/i.test(style)) return 1
  if (outline !== null && Number.isFinite(outline)) return Math.min(6, Math.max(1, outline + 1))
  return null
}
