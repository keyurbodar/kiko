type Entry = { method: number; size: number; offset: number }

const u16 = (view: DataView, at: number) => view.getUint16(at, true)
const u32 = (view: DataView, at: number) => view.getUint32(at, true)

function entries(bytes: Uint8Array): Map<string, Entry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  while (end >= 0 && u32(view, end) !== 0x06054b50) end--
  if (end < 0) throw new Error("Not a zip file")
  const names = new TextDecoder()
  const out = new Map<string, Entry>()
  let at = u32(view, end + 16)
  for (let i = u16(view, end + 10); i > 0 && u32(view, at) === 0x02014b50; i--) {
    const nameLength = u16(view, at + 28)
    const name = names.decode(bytes.subarray(at + 46, at + 46 + nameLength))
    out.set(name, { method: u16(view, at + 10), size: u32(view, at + 20), offset: u32(view, at + 42) })
    at += 46 + nameLength + u16(view, at + 30) + u16(view, at + 32)
  }
  return out
}

async function read(bytes: Uint8Array, entry: Entry): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const start = entry.offset + 30 + u16(view, entry.offset + 26) + u16(view, entry.offset + 28)
  const packed = bytes.slice(start, start + entry.size)
  if (entry.method === 0) return new TextDecoder().decode(packed)
  if (entry.method !== 8) throw new Error(`Unsupported zip method ${entry.method}`)
  const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
  return new Response(stream).text()
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }

const unescape = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) => {
    if (name[0] !== "#") return ENTITIES[name] ?? whole
    return String.fromCodePoint(
      name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1)),
    )
  })

const texts = (xml: string) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => unescape(m[1] ?? "")).join("")

function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1] ?? ""))
}

function column(ref: string): number {
  let n = 0
  for (const c of /^[A-Z]+/.exec(ref)?.[0] ?? "") n = n * 26 + c.charCodeAt(0) - 64
  return Math.max(0, n - 1)
}

function cellText(attrs: string, body: string, shared: readonly string[]): string {
  const type = /\bt="(\w+)"/.exec(attrs)?.[1]
  if (type === "inlineStr") return texts(body)
  const value = unescape(/<v>([^<]*)<\/v>/.exec(body)?.[1] ?? "")
  if (type === "s") return shared[Number(value)] ?? ""
  if (type === "b") return value === "1" ? "TRUE" : "FALSE"
  return value
}

function sheetRows(xml: string, shared: readonly string[], limit: number, width: number, cellLimit = 2000): string[][] {
  const rows: string[][] = []
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= limit) break
    const cells: string[] = []
    for (const cell of (row[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1] ?? ""
      const at = column(/\br="([A-Z]+)/.exec(attrs)?.[1] ?? "") || cells.length
      if (at >= width) continue
      while (cells.length < at) cells.push("")
      cells[at] = cellText(attrs, cell[2] ?? "", shared).slice(0, cellLimit)
    }
    rows.push(cells)
  }
  return rows
}

export type XlsxSheet = { name: string; rows: string[][]; truncated: boolean }

type SheetPart = { name: string; path: string }

function sheetParts(workbook: string, relationships: string): SheetPart[] {
  const targets = new Map<string, string>()
  for (const match of relationships.matchAll(/<Relationship\b([^>]*)>/g)) {
    const body = match[1] ?? ""
    const id = /\bId=["']([^"']*)["']/.exec(body)?.[1]
    const target = /\bTarget=["']([^"']*)["']/.exec(body)?.[1]
    if (id && target) targets.set(id, target.replace(/^\//, ""))
  }
  const parts: SheetPart[] = []
  for (const match of workbook.matchAll(/<sheet\b([^>]*)>/g)) {
    const body = match[1] ?? ""
    const name = /\bname=["']([^"']*)["']/.exec(body)?.[1] ?? `Sheet ${parts.length + 1}`
    const id = /\br:id=["']([^"']*)["']/.exec(body)?.[1]
    const target = id ? targets.get(id) : undefined
    const path = target?.startsWith("xl/") ? target : `xl/${target ?? ""}`
    if (path) parts.push({ name, path })
  }
  return parts
}

export async function xlsxSheets(
  bytes: Uint8Array,
  limits: { rows: number; columns: number; cell: number; sheets?: number } = { rows: 500, columns: 64, cell: 512 },
): Promise<XlsxSheet[]> {
  const zip = entries(bytes)
  const workbookEntry = zip.get("xl/workbook.xml")
  const relsEntry = zip.get("xl/_rels/workbook.xml.rels")
  const workbook = workbookEntry ? await read(bytes, workbookEntry) : ""
  const relationships = relsEntry ? await read(bytes, relsEntry) : ""
  const strings = zip.get("xl/sharedStrings.xml")
  const shared = strings ? sharedStrings(await read(bytes, strings)) : []
  let parts = workbook ? sheetParts(workbook, relationships) : []
  if (!parts.length)
    parts = [...zip.keys()]
      .filter((name) => /^xl\/worksheets\/[^/]+\.xml$/.test(name))
      .map((path, index) => ({ name: `Sheet ${index + 1}`, path }))
  const sheets: XlsxSheet[] = []
  for (const part of parts.slice(0, limits.sheets ?? 24)) {
    const entry = zip.get(part.path)
    if (!entry) continue
    const xml = await read(bytes, entry)
    const rows = sheetRows(xml, shared, limits.rows, limits.columns, limits.cell)
    const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0)
    sheets.push({
      name: part.name,
      rows: rows.map((row) => row.map((cell) => (cell.length > limits.cell ? cell.slice(0, limits.cell) : cell))),
      truncated: rows.length >= limits.rows || width >= limits.columns,
    })
  }
  return sheets
}

export async function xlsxRows(bytes: Uint8Array, limit = 12, width = 8): Promise<string[][]> {
  const sheets = await xlsxSheets(bytes, { rows: limit, columns: width, cell: 2000, sheets: 1 })
  return sheets[0]?.rows ?? []
}
