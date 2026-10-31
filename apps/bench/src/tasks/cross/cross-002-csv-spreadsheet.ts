import type { Task } from "../../types"
import { check, int, LIMITS, mulberry32, pick, python, readText, run, verdict, writeJson, writeText } from "../helpers"
import { downloadInBrowser, openCross } from "./support"

const REGIONS = ["EU", "US", "EU", "APAC", "EU", "EU", "US", "EU", "EU", "US"]
const NOTES = ["paid, in full", "net 30", "deposit", "awaiting invoice", "card, cleared"]

interface Row {
  readonly id: string
  readonly region: string
  readonly raw: string
  readonly note: string
}

interface Plan {
  readonly csv: string
  readonly clean: Array<{ order: string; amount: string }>
  readonly total: string
}

const csvCell = (value: string): string => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

const money = (cents: number, withEuro: boolean): string => {
  const whole = Math.floor(cents / 100)
  const rest = String(cents % 100).padStart(2, "0")
  const grouped = whole >= 1000 ? `${Math.floor(whole / 1000)},${String(whole % 1000).padStart(3, "0")}` : `${whole}`
  return `${withEuro ? "€" : ""}${grouped}.${rest}`
}

const plan = (seed: number): Plan => {
  const rng = mulberry32(seed)
  const rows: Row[] = REGIONS.map((region, index) => {
    const cents = int(rng, 1000, 999_999)
    const raw = index === 8 ? "" : money(cents, index % 3 === 0)
    return { id: `ORD-${3000 + index}`, region, raw, note: pick(rng, NOTES) }
  })
  const header = "order_id,region,amount,note"
  const csv = `${[header, ...rows.map((row) => [row.id, row.region, row.raw, row.note].map(csvCell).join(","))].join("\n")}\n`
  const clean = rows
    .filter((row) => row.region === "EU" && row.raw.trim() !== "")
    .map((row) => ({ order: row.id, amount: (Number(row.raw.replace(/€/g, "").replace(/,/g, "")) || 0).toFixed(2) }))
  const total = clean.reduce((sum, row) => sum + Number(row.amount), 0).toFixed(2)
  return { csv, clean, total }
}

const MAKE_REPORT = `import csv
import zipfile

rows = list(csv.DictReader(open("sales.csv", newline="")))
clean = []
for row in rows:
    if row["region"] != "EU":
        continue
    raw = (row["amount"] or "").replace("€", "").replace(",", "").strip()
    if not raw:
        continue
    try:
        value = float(raw)
    except ValueError:
        continue
    clean.append((row["order_id"], f"{value:.2f}"))

with open("clean.csv", "w", newline="") as handle:
    writer = csv.writer(handle, lineterminator="\\n")
    writer.writerow(["order", "amount"])
    for order, amount in clean:
        writer.writerow([order, amount])

total = sum(float(amount) for _, amount in clean)


def esc(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def cell(text=None, value=None, formula=None):
    attributes = ""
    if formula:
        attributes += ' table:formula="' + formula + '"'
    if value is not None:
        attributes += ' office:value-type="float" office:value="' + value + '"'
    elif text is not None:
        attributes += ' office:value-type="string"'
    inner = "<text:p>" + esc(text) + "</text:p>" if text is not None else ""
    return "<table:table-cell" + attributes + ">" + inner + "</table:table-cell>"


body = ['<table:table-row>' + cell("order") + cell("amount") + "</table:table-row>"]
for order, amount in clean:
    body.append("<table:table-row>" + cell(order) + cell(value=amount, text=amount) + "</table:table-row>")
last = len(clean) + 1
body.append(
    "<table:table-row>"
    + cell("total")
    + cell(value=f"{total:.2f}", formula=f"of:=SUM([.B2:.B{last}])", text=f"{total:.2f}")
    + "</table:table-row>"
)

content = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"'
    ' xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"'
    ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">'
    "<office:body><office:spreadsheet><table:table table:name=\\"Sheet1\\">"
    + "".join(body)
    + "</table:table></office:spreadsheet></office:body></office:document-content>"
)
manifest = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">'
    '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>'
    '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
    "</manifest:manifest>"
)
with zipfile.ZipFile("report.ods", "w") as archive:
    archive.writestr("mimetype", "application/vnd.oasis.opendocument.spreadsheet", compress_type=zipfile.ZIP_STORED)
    archive.writestr("META-INF/manifest.xml", manifest)
    archive.writestr("content.xml", content)
`

const READ_ODS = `import json
import zipfile
import xml.etree.ElementTree as ET

NS = {
    "table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
    "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
}
archive = zipfile.ZipFile("report.ods")
root = ET.fromstring(archive.read("content.xml"))
table = root.find(".//table:table", NS)
rows = []
for row in table.findall("table:table-row", NS):
    row_repeat = int(row.get("{%s}number-rows-repeated" % NS["table"], "1"))
    cells = []
    for cell in row.findall("table:table-cell", NS):
        repeat = int(cell.get("{%s}number-columns-repeated" % NS["table"], "1"))
        entry = {
            "text": "".join(cell.itertext()).strip(),
            "value": cell.get("{%s}value" % NS["office"]),
            "formula": cell.get("{%s}formula" % NS["table"]),
        }
        cells.extend([entry] * min(repeat, 20))
    rows.extend([cells] * min(row_repeat, 40))
print(json.dumps(rows))
`

const number = (cell: { value?: string; text?: string } | undefined): number => {
  const raw = cell?.value ?? cell?.text ?? ""
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

export const csvSpreadsheet: Task = {
  id: "cross-002-csv-spreadsheet",
  track: "cross",
  os: ["linux", "macos"],
  needs: ["chrome", "display", "libreoffice"],
  heldOut: false,
  kind: "real",
  prompt:
    "The dashboard at url.txt has a sales export. Download it, keep the EU orders, and write clean.csv with the header order,amount and the amounts as plain numbers with two decimals. Then open clean.csv in LibreOffice Calc, put a SUM formula for the amount column in the cell under the last amount, and save it as report.ods in this folder.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const { csv } = plan(seed)
    await writeJson(m, "request.json", { region: "EU" })
    await openCross(m, "cross-002-csv-spreadsheet", { csv }, "/")
  },
  oracle: async (m) => {
    await downloadInBrowser("cross-002-csv-spreadsheet", m.workdir, "sales.csv")
    await writeText(m, "make_report.py", MAKE_REPORT)
    const result = await run(m, [python(m), "make_report.py"])
    await run(m, [python(m), "-c", 'import os; os.remove("make_report.py")'])
    if (result.code !== 0) throw new Error(`report failed: ${result.stderr || result.stdout}`)
  },
  check: async (m, seed) => {
    const { clean, total } = plan(seed)
    const expected = `order,amount\n${clean.map((row) => `${row.order},${row.amount}`).join("\n")}\n`
    const cleanCsv = await readText(m, "clean.csv")
    const report = await run(m, [python(m), "-c", READ_ODS])
    let rows: Array<Array<{ text: string; value?: string; formula?: string }>> = []
    try {
      rows = JSON.parse(report.stdout.trim()) as Array<Array<{ text: string; value?: string; formula?: string }>>
    } catch {}
    const header = rows[0] ?? []
    const dataRows = rows.slice(1, clean.length + 1)
    const totalRow = rows[clean.length + 1] ?? []
    const dataOk = dataRows.every(
      (row, index) =>
        row[0]?.text === clean[index]?.order && Math.abs(number(row[1]) - Number(clean[index]?.amount)) < 0.005,
    )
    const formula = totalRow[1]?.formula ?? ""
    return verdict([
      check("clean.csv matches", cleanCsv === expected, `clean.csv was ${JSON.stringify(cleanCsv?.slice(0, 300))}`),
      check("report opens", report.code === 0, `could not read report.ods: ${report.stderr.slice(-300)}`),
      check(
        "header kept",
        header[0]?.text === "order" && header[1]?.text === "amount",
        `header was ${JSON.stringify(header)}`,
      ),
      check("amounts kept", dataOk, `data rows were ${JSON.stringify(dataRows)}`),
      check("sum formula", /SUM/i.test(formula), `formula was ${JSON.stringify(formula)}`),
      check(
        "sum value",
        Math.abs(number(totalRow[1]) - Number(total)) < 0.005,
        `cached total was ${JSON.stringify(totalRow[1]?.value ?? totalRow[1]?.text)}, expected ${total}`,
      ),
    ])
  },
}
