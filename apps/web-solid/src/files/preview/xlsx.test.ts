import { describe, expect, it } from "vitest"
import { xlsxRows, xlsxSheets } from "./xlsx"

const encoder = new TextEncoder()

async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function zip(files: Record<string, string>, packed: boolean): Promise<Uint8Array> {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const raw = encoder.encode(text)
    const data = packed ? await deflate(raw) : raw
    const nameBytes = encoder.encode(name)
    const local = new Uint8Array(30 + nameBytes.length + data.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(8, packed ? 8 : 0, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, raw.length, true)
    lv.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    local.set(data, 30 + nameBytes.length)
    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(10, packed ? 8 : 0, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, raw.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const size = centrals.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, centrals.length, true)
  ev.setUint16(10, centrals.length, true)
  ev.setUint32(12, size, true)
  ev.setUint32(16, offset, true)
  const parts = [...locals, ...centrals, end]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const workbook = {
  "xl/sharedStrings.xml": `<sst><si><t>Item</t></si><si><t>Cost</t></si><si><r><t>Hotel</t></r><r><t xml:space="preserve"> &amp; tax</t></r></si></sst>`,
  "xl/worksheets/sheet1.xml": `<worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
    <row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>120.5</v></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Paid</t></is></c><c r="B3" t="b"><v>1</v></c></row>
  </sheetData></worksheet>`,
}

describe("xlsxRows", () => {
  it("reads the first sheet with shared, inline and boolean cells", async () => {
    expect(await xlsxRows(await zip(workbook, false))).toEqual([
      ["Item", "Cost"],
      ["Hotel & tax", "", "120.5"],
      ["Paid", "TRUE"],
    ])
  })

  it("inflates deflated entries", async () => {
    expect((await xlsxRows(await zip(workbook, true)))[1]).toEqual(["Hotel & tax", "", "120.5"])
  })

  it("stops at the row and column limits", async () => {
    expect(await xlsxRows(await zip(workbook, false), 2, 1)).toEqual([["Item"], ["Hotel & tax"]])
  })

  it("rejects bytes that are not a zip", async () => {
    await expect(xlsxRows(encoder.encode("not a workbook"))).rejects.toThrow()
  })
})

const multi = {
  "xl/workbook.xml": `<workbook><sheets>
    <sheet name="Budget" sheetId="1" r:id="rId1"/>
    <sheet name="Packing" sheetId="2" r:id="rId2"/>
  </sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<Relationships>
    <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
    <Relationship Id="rId2" Target="worksheets/sheet2.xml"/>
  </Relationships>`,
  "xl/sharedStrings.xml": `<sst><si><t>Item</t></si><si><t>Cost</t></si></sst>`,
  "xl/worksheets/sheet1.xml": `<worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Hotels</t></is></c><c r="B2"><v>420</v></c></row>
  </sheetData></worksheet>`,
  "xl/worksheets/sheet2.xml": `<worksheet><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Bags</t></is></c></row>
  </sheetData></worksheet>`,
}

describe("xlsxSheets", () => {
  it("reads every sheet in workbook order with its name", async () => {
    const sheets = await xlsxSheets(await zip(multi, false))
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Budget", "Packing"])
    expect(sheets[0]!.rows).toEqual([
      ["Item", "Cost"],
      ["Hotels", "420"],
    ])
    expect(sheets[1]!.rows).toEqual([["Bags"]])
    expect(sheets.every((sheet) => !sheet.truncated)).toBe(true)
  })

  it("reports a sheet cut at the preview limits", async () => {
    const sheets = await xlsxSheets(await zip(multi, false), { rows: 1, columns: 8, cell: 512 })
    expect(sheets[0]!.truncated).toBe(true)
  })
})
