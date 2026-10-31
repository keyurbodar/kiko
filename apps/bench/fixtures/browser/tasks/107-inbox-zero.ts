import { escape, html, json, type Handlers } from "../types"

type Message = { id: string; from: string; subject: string; folder: string; labels: string[] }

const row = (message: Message): string => `
<li>
  <strong>${escape(message.subject)}</strong> from ${escape(message.from)}
  <div>Folder: ${escape(message.folder)}. Labels: ${escape(message.labels.join(", ") || "none")}</div>
  <button onclick="act('${escape(message.id)}', 'archive')">Archive</button>
  <button onclick="act('${escape(message.id)}', 'delete')">Delete</button>
  <input id="label-${escape(message.id)}" placeholder="label"> <button onclick="act('${escape(message.id)}', 'label')">Add label</button>
</li>`

export const inboxZero: Handlers = {
  pages: {
    "/inbox": (ctx) => {
      const messages = (ctx.state.messages as Message[] | undefined) ?? (ctx.data.messages as Message[])
      return html(`
<h1>Inbox</h1>
<p>${messages.filter((message) => message.folder === "inbox").length} messages in the inbox, ${messages.length} in total.</p>
<ul>${messages.map(row).join("\n  ")}</ul>
<p id="message"></p>
<script>
async function act(id, action) {
  const label = document.getElementById("label-" + id)
  const body = { id, action, value: action === "label" ? (label ? label.value : "") : "" }
  const response = await fetch("/api/messages/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  if (response.ok) location.reload()
  else document.getElementById("message").textContent = data.error || "Rejected."
}
</script>`)
    },
  },
  api: {
    "POST /api/messages/action": (ctx, body) => {
      const messages = ((ctx.state.messages as Message[] | undefined) ??
        structuredClone(ctx.data.messages as Message[])) as Message[]
      const message = messages.find((entry) => entry.id === String(body?.id ?? ""))
      if (!message) return json({ error: "No such message." }, 404)
      const action = String(body?.action ?? "")
      const value = String(body?.value ?? "").trim()
      if (action === "archive") message.folder = "archive"
      else if (action === "delete") message.folder = "trash"
      else if (action === "label") {
        if (!value) return json({ error: "Enter a label." }, 400)
        if (!message.labels.includes(value)) message.labels.push(value)
      } else return json({ error: "Unknown action." }, 400)
      ctx.record("messages", messages)
      return json({ ok: true })
    },
  },
}
