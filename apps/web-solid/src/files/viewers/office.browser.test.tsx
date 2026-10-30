import "../../index.css"
import JSZip from "jszip"
import { expect, it } from "vitest"
import { render } from "../../../test/render"
import OfficeViewer from "./office"

function container(): HTMLElement {
  const element = document.createElement("div")
  element.style.cssText = "display:flex;width:900px;height:600px"
  return element
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

async function docx(): Promise<Blob> {
  const zip = new JSZip()
  zip.file(
    "word/document.xml",
    `<w:document ${W}><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Trip plan</w:t></w:r></w:p>
      <w:p><w:r><w:t>Two nights in Lisbon</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>City</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>`,
  )
  return zip.generateAsync({ type: "blob" })
}

async function pptx(): Promise<Blob> {
  const zip = new JSZip()
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>`,
  )
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/></Relationships>`,
  )
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:txBody><a:p><a:r><a:t>Trip plan</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:txBody><a:p><a:r><a:t>Three cities</a:t></a:r></a:p></p:txBody></p:sp>
    </p:spTree></p:cSld></p:sld>`,
  )
  return zip.generateAsync({ type: "blob" })
}

async function xlsx(): Promise<Blob> {
  const zip = new JSZip()
  zip.file(
    "xl/workbook.xml",
    `<workbook><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Packing" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  )
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`,
  )
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Item</t></is></c><c r="B1" t="inlineStr"><is><t>Cost</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>Hotels</t></is></c><c r="B2"><v>420</v></c></row>
    </sheetData></worksheet>`,
  )
  zip.file(
    "xl/worksheets/sheet2.xml",
    `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Bags</t></is></c></row></sheetData></worksheet>`,
  )
  return zip.generateAsync({ type: "blob" })
}

it("opens a Word document with headings, paragraphs and tables", async () => {
  const blob = await docx()
  const url = URL.createObjectURL(blob)
  try {
    await using screen = await render(() => <OfficeViewer src={url} name="plan.docx" kind="docx" size={blob.size} />, {
      container: container(),
    })
    await expect.element(screen.getByRole("heading", { name: "Trip plan" })).toBeVisible()
    expect(screen.container.textContent).toContain("Two nights in Lisbon")
    expect(screen.container.querySelector("table")?.textContent).toContain("City")
  } finally {
    URL.revokeObjectURL(url)
  }
})

it("walks the slides of a presentation", async () => {
  const blob = await pptx()
  const url = URL.createObjectURL(blob)
  try {
    await using screen = await render(() => <OfficeViewer src={url} name="talk.pptx" kind="pptx" size={blob.size} />, {
      container: container(),
    })
    await expect.element(screen.getByText("Slide 1 of 1")).toBeVisible()
    await expect.element(screen.getByRole("heading", { name: "Trip plan" })).toBeVisible()
    expect(screen.container.textContent).toContain("Three cities")
  } finally {
    URL.revokeObjectURL(url)
  }
})

it("shows a spreadsheet as tabs of tables", async () => {
  const blob = await xlsx()
  const url = URL.createObjectURL(blob)
  try {
    await using screen = await render(
      () => <OfficeViewer src={url} name="budget.xlsx" kind="xlsx" size={blob.size} />,
      { container: container() },
    )
    await expect.element(screen.getByRole("tab", { name: "Budget" })).toBeVisible()
    expect(screen.container.textContent).toContain("Hotels")
    expect(screen.container.textContent).toContain("1 rows, 2 columns")
    await screen.getByRole("tab", { name: "Packing" }).click()
    await expect.element(screen.getByText("Bags")).toBeVisible()
    const pill = screen.container.querySelector<HTMLElement>("[data-component=file-sheet] .pill-indicator")
    expect(pill?.getBoundingClientRect().height ?? 0).toBeLessThan(48)
  } finally {
    URL.revokeObjectURL(url)
  }
})
