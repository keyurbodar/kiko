import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const readText = (workdir: string, name: string): string => readFileSync(join(workdir, name), "utf8").trim()

const baseOf = (workdir: string): string => new URL(readText(workdir, "url.txt")).origin

const page = async (workdir: string, path: string): Promise<string> => {
  const response = await fetch(`${baseOf(workdir)}${path}`)
  if (!response.ok) throw new Error(`GET ${path} -> ${response.status}`)
  return response.text()
}

const post = async (workdir: string, path: string, body: unknown): Promise<void> => {
  const response = await fetch(`${baseOf(workdir)}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`POST ${path} -> ${response.status}`)
}

const attribute = (text: string, name: string): string => {
  const match = text.match(new RegExp(`data-${name}="([^"]+)"`))
  if (!match?.[1]) throw new Error(`no data-${name} on the page`)
  return match[1]
}

const rows = (text: string): string[][] =>
  [...text.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    .map((match) => [...match[1]!.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((cell) => cell[1]!.trim()))
    .filter((row) => row.length > 0)

export const browserValue = async (task: string, workdir: string): Promise<string> => {
  const text = await page(workdir, "/")
  if (task === "cross-001-dashboard-config") return attribute(text, "region")
  if (task === "cross-004-release-checklist") return attribute(text, "version")
  if (task === "cross-005-order-receipt") {
    const row = rows(text).find((cell) => cell[2] === "pending")
    if (!row) throw new Error("no pending order on the page")
    return row[0]!
  }
  throw new Error(`no browser value for ${task}`)
}

export const browserDownload = async (task: string, workdir: string, name: string): Promise<void> => {
  if (task !== "cross-002-csv-spreadsheet") throw new Error(`no download for ${task}`)
  const response = await fetch(`${baseOf(workdir)}/sales.csv`)
  if (!response.ok) throw new Error(`GET /sales.csv -> ${response.status}`)
  writeFileSync(join(workdir, name), await response.text())
}

export const browserSubmit = async (task: string, workdir: string, value: string): Promise<void> => {
  if (task === "cross-004-release-checklist") {
    const version = attribute(await page(workdir, "/"), "version")
    await post(workdir, "/api/release", { version, hash: value })
    return
  }
  if (task === "cross-005-order-receipt") {
    const order = await browserValue(task, workdir)
    await post(workdir, "/api/settle", { order, total: value })
    return
  }
  throw new Error(`no browser submission for ${task}`)
}
