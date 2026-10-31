import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (workdir: string, name: string): any => JSON.parse(readFileSync(join(workdir, name), "utf8"))
const readText = (workdir: string, name: string): string => readFileSync(join(workdir, name), "utf8").trim()

export const runBrowserOracle = async (task: string, workdir: string): Promise<void> => {
  const data = read(workdir, "data.json")
  const request = read(workdir, "request.json")
  const base = new URL(readText(workdir, "url.txt")).origin

  const get = async (path: string): Promise<string> => {
    const response = await fetch(`${base}${path}`)
    if (!response.ok) throw new Error(`GET ${path} -> ${response.status}`)
    return response.text()
  }
  const post = async (path: string, body: unknown): Promise<Response> =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  const need = (response: Response): void => {
    if (!response.ok) throw new Error(`${response.url} -> ${response.status}`)
  }
  const cells = (page: string): string[][] =>
    [...page.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
      .map((match) => [...match[1]!.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((cell) => cell[1]!.trim()))
      .filter((row) => row.length > 0)

  if (task === "browser-001-form-signup") {
    need(await post("/api/signup", request))
    return
  }
  if (task === "browser-002-cookie-banner") {
    need(await post("/api/consent", {}))
    need(await post("/api/subscribe", { email: request.email }))
    return
  }
  if (task === "browser-003-two-tabs") {
    const row = cells(await get("/orders")).find((cell) => cell[1] === data.targetCustomer)
    if (!row) throw new Error("order not found")
    need(await post("/api/claim", { order: row[0], reason: request.reason }))
    return
  }
  if (task === "browser-004-hidden-tab") {
    need(await post("/api/dashboard/open", {}))
    need(await post("/api/survey", { rating: request.rating }))
    return
  }
  if (task === "browser-005-download") {
    const cents = (await get("/sales.csv"))
      .trim()
      .split("\n")
      .slice(1)
      .reduce((sum, line) => sum + Math.round(Number(line.split(",")[1]) * 100), 0)
    need(await post("/api/answer", { value: (cents / 100).toFixed(2) }))
    return
  }
  if (task === "browser-006-table-extract") {
    const rows = cells(await get("/team"))
    const best = rows.reduce((top, row) => (Number(row[2]) > Number(top[2]) ? row : top))
    need(await post("/api/answer", { value: best[1] }))
    return
  }
  if (task === "browser-007-login") {
    const response = await post("/api/login", { user: request.user, password: request.password })
    need(response)
    const { token } = (await response.json()) as { token: string }
    need(await post("/api/answer", { value: token }))
    return
  }
  if (task === "browser-008-search-filter") {
    const row = cells(await get("/invoices")).find((cell) => cell[1] === request.customer && cell[2] === request.status)
    if (!row) throw new Error("invoice not found")
    need(await post("/api/answer", { value: row[0] }))
    return
  }
  if (task === "browser-009-pagination") {
    const pages = Math.ceil((data.records as unknown[]).length / 8)
    for (let page = 1; page <= pages; page += 1) {
      const row = cells(await get(`/records?page=${page}`)).find((cell) => cell[0] === data.targetId)
      if (row) {
        need(await post("/api/answer", { value: row[2] }))
        return
      }
    }
    throw new Error("record not found")
  }
  if (task === "browser-010-modal-delete") {
    const draft = (data.drafts as Array<{ id: string; title: string }>).find((entry) => entry.title === request.title)
    if (!draft) throw new Error("draft not found")
    need(await post("/api/drafts/delete", { id: draft.id }))
    return
  }
  throw new Error(`no oracle for ${task}`)
}
