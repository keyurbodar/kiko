import { escape, html, json, type Handlers } from "../types"

type Issue = {
  id: string
  title: string
  body: string
  state: "open" | "closed"
  labels: string[]
  assignee: string | null
  duplicateOf: string | null
}

const issueList = (issues: Issue[]): string => `
<ul>
  ${issues
    .map(
      (issue) => `<li id="${escape(issue.id)}">
    <strong>${escape(issue.id)}</strong> ${escape(issue.title)}
    <div>${escape(issue.body)}</div>
    <div>State: ${escape(issue.state)}. Labels: ${escape(issue.labels.join(", ") || "none")}. Assignee: ${escape(issue.assignee ?? "none")}.${issue.duplicateOf ? ` Duplicate of ${escape(issue.duplicateOf)}.` : ""}</div>
    <input id="label-${escape(issue.id)}" placeholder="label"> <button onclick="act('label', '${escape(issue.id)}')">Add label</button>
    <select id="assign-${escape(issue.id)}"><option value=""></option><option>mira</option><option>omar</option><option>priya</option></select>
    <button onclick="act('assign', '${escape(issue.id)}')">Assign</button>
    <input id="dup-${escape(issue.id)}" placeholder="duplicate of"> <button onclick="act('close', '${escape(issue.id)}')">Close as duplicate</button>
  </li>`,
    )
    .join("\n  ")}
</ul>`

export const issueTriage: Handlers = {
  pages: {
    "/issues": (ctx) => {
      const issues = (ctx.state.issues as Issue[] | undefined) ?? (ctx.data.issues as Issue[])
      return html(`
<h1>Issue tracker</h1>
${issueList(issues)}
<p id="message"></p>
<script>
async function act(kind, id) {
  let body
  let path
  if (kind === "label") { body = { id, label: document.getElementById("label-" + id).value }; path = "/api/issues/label" }
  if (kind === "assign") { body = { id, assignee: document.getElementById("assign-" + id).value }; path = "/api/issues/assign" }
  if (kind === "close") { body = { id, duplicateOf: document.getElementById("dup-" + id).value }; path = "/api/issues/close" }
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  if (response.ok) location.reload()
  else document.getElementById("message").textContent = data.error || "Rejected."
}
</script>`)
    },
  },
  api: {
    "POST /api/issues/label": (ctx, body) => {
      const issues = ((ctx.state.issues as Issue[] | undefined) ??
        structuredClone(ctx.data.issues as Issue[])) as Issue[]
      const issue = issues.find((entry) => entry.id === String(body?.id ?? ""))
      const label = String(body?.label ?? "").trim()
      if (!issue) return json({ error: "No such issue." }, 404)
      if (!label) return json({ error: "Enter a label." }, 400)
      if (!issue.labels.includes(label)) issue.labels.push(label)
      ctx.record("issues", issues)
      return json({ ok: true })
    },
    "POST /api/issues/assign": (ctx, body) => {
      const issues = ((ctx.state.issues as Issue[] | undefined) ??
        structuredClone(ctx.data.issues as Issue[])) as Issue[]
      const issue = issues.find((entry) => entry.id === String(body?.id ?? ""))
      const assignee = String(body?.assignee ?? "").trim()
      if (!issue) return json({ error: "No such issue." }, 404)
      if (!assignee) return json({ error: "Choose a person." }, 400)
      issue.assignee = assignee
      ctx.record("issues", issues)
      return json({ ok: true })
    },
    "POST /api/issues/close": (ctx, body) => {
      const issues = ((ctx.state.issues as Issue[] | undefined) ??
        structuredClone(ctx.data.issues as Issue[])) as Issue[]
      const issue = issues.find((entry) => entry.id === String(body?.id ?? ""))
      const duplicateOf = String(body?.duplicateOf ?? "").trim()
      if (!issue) return json({ error: "No such issue." }, 404)
      if (!issues.some((entry) => entry.id === duplicateOf) || duplicateOf === issue.id)
        return json({ error: "Name another issue as the duplicate." }, 400)
      issue.state = "closed"
      issue.duplicateOf = duplicateOf
      if (!issue.labels.includes("duplicate")) issue.labels.push("duplicate")
      ctx.record("issues", issues)
      return json({ ok: true })
    },
  },
}
