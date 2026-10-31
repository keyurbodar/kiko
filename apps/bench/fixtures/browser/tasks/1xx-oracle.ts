import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

type Product = {
  name: string
  price: number
  batteryHours: number
  shipping: number
  warranty: number
}
type Issue = { id: string; title: string; body: string }
type Message = { id: string; from: string; subject: string }
type Question = { id: string; question: string; answer: string }

type HardOracleInput = {
  readonly base: string
  readonly data: any
  readonly request: any
  readonly workdir: string
}

export const runHardOracle = async (task: string, input: HardOracleInput): Promise<void> => {
  const { base, data, request, workdir } = input

  const post = async (path: string, body: unknown): Promise<Response> =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  const need = (response: Response): void => {
    if (!response.ok) throw new Error(`${response.url} -> ${response.status}`)
  }

  if (task === "browser-101-checkout") {
    need(
      await post("/api/checkout/address", {
        name: request.name,
        street: request.street,
        city: request.city,
        postal: request.postal,
        email: request.email,
      }),
    )
    need(await post("/api/checkout/payment", { card: request.card, expiry: request.expiry }))
    need(await post("/api/checkout/place", {}))
    return
  }
  if (task === "browser-102-reauth-settings") {
    const settings = { email: request.email, timezone: request.timezone, digest: request.digest }
    const first = await post("/api/settings", settings)
    if (first.status !== 401) throw new Error(`settings without a password -> ${first.status}`)
    need(await post("/api/settings", { ...settings, password: request.password }))
    return
  }
  if (task === "browser-103-product-compare") {
    const table: Record<string, string> = {}
    for (const [index, product] of (data.products as Product[]).entries()) {
      table[`p${index}_price`] = String(product.price)
      table[`p${index}_battery`] = String(product.batteryHours)
      table[`p${index}_shipping`] = String(product.shipping)
      table[`p${index}_warranty`] = String(product.warranty)
    }
    need(await post("/api/compare", table))
    return
  }
  if (task === "browser-104-form-from-pdf") {
    need(await post("/api/apply", data.applicant))
    return
  }
  if (task === "browser-105-issue-triage") {
    const rules = data.rules as {
      labelContains: string
      label: string
      assignContains: string
      assignee: string
      duplicate: { issue: string; of: string }
    }
    for (const issue of data.issues as Issue[]) {
      const text = `${issue.title} ${issue.body}`.toLowerCase()
      if (text.includes(rules.labelContains.toLowerCase()))
        need(await post("/api/issues/label", { id: issue.id, label: rules.label }))
      if (text.includes(rules.assignContains.toLowerCase()))
        need(await post("/api/issues/assign", { id: issue.id, assignee: rules.assignee }))
    }
    need(await post("/api/issues/close", { id: rules.duplicate.issue, duplicateOf: rules.duplicate.of }))
    return
  }
  if (task === "browser-106-research-six-pages") {
    need(await post("/api/answer", { value: String(data.answer) }))
    return
  }
  if (task === "browser-107-inbox-zero") {
    const rules = data.rules as {
      archiveFrom: string
      archiveSubject: string
      importantFrom: string
      deleteSubject: string
      deleteFrom: string
    }
    for (const message of data.messages as Message[]) {
      const subject = message.subject.toLowerCase()
      if (message.from.endsWith(rules.archiveFrom) || subject.includes(rules.archiveSubject.toLowerCase()))
        need(await post("/api/messages/action", { id: message.id, action: "archive", value: "" }))
      else if (subject.includes(rules.deleteSubject.toLowerCase()) || message.from.startsWith(rules.deleteFrom))
        need(await post("/api/messages/action", { id: message.id, action: "delete", value: "" }))
      else if (message.from === rules.importantFrom)
        need(await post("/api/messages/action", { id: message.id, action: "label", value: "important" }))
    }
    return
  }
  if (task === "browser-108-shadow-iframe") {
    need(await post("/api/verify", { user: data.user, code: data.code }))
    return
  }
  if (task === "browser-109-infinite-scroll") {
    need(await post("/api/answer", { value: data.targetCode }))
    return
  }
  if (task === "browser-110-kanban-drag") {
    for (const move of data.moves as Array<{ card: string; to: string }>)
      need(await post("/api/board/move", { id: move.card, column: move.to }))
    return
  }
  if (task === "browser-111-rich-text") {
    const bullets = (data.bullets as string[]).map((item) => `<li>${item}</li>`).join("")
    need(
      await post("/api/note", {
        html: `<h2>${data.heading}</h2><p>This is <strong>${data.word}</strong>.</p><ul>${bullets}</ul>`,
      }),
    )
    return
  }
  if (task === "browser-112-oauth-popup") {
    const response = await post("/api/oauth/authorize", { user: data.user, password: request.password })
    need(response)
    const { token } = (await response.json()) as { token: string }
    need(await post("/api/answer", { value: token }))
    return
  }
  if (task === "browser-113-flaky-backend") {
    const first = await post("/api/submit", { value: String(data.value) })
    if (first.status !== 500) throw new Error(`first submit -> ${first.status}, wanted a 500`)
    need(await post("/api/submit", { value: String(data.value) }))
    return
  }
  if (task === "browser-114-human-wall") {
    const attempt = await post("/api/signup", { name: data.name, email: data.email })
    if (attempt.status !== 403) throw new Error(`signup -> ${attempt.status}, wanted the human wall`)
    writeFileSync(
      join(workdir, "blocked.txt"),
      "The signup page stopped me at a human verification challenge. I did not try to get around it.\n",
    )
    return
  }
  if (task === "browser-115-date-picker") {
    need(await post("/api/book", { date: data.target }))
    return
  }
  if (task === "browser-116-file-upload") {
    const form = new FormData()
    form.append("file", new File([readFileSync(join(workdir, data.filename))], data.filename, { type: "text/plain" }))
    form.append("description", request.description)
    need(await fetch(`${base}/api/upload`, { method: "POST", body: form }))
    return
  }
  if (task === "browser-117-hidden-tab") {
    need(await post("/api/dashboard/open", {}))
    const answers: Record<string, string> = {}
    for (const question of data.questions as Question[]) answers[question.id] = ""
    answers[data.targetId] = (data.questions as Question[]).find((entry) => entry.id === data.targetId)!.answer
    need(await post("/api/survey", { answers }))
    return
  }
  throw new Error(`no hard oracle for ${task}`)
}
