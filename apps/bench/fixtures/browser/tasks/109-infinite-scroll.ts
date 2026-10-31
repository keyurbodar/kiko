import { escape, html, json, type Handlers } from "../types"

type Item = { id: string; code: string }

export const infiniteScroll: Handlers = {
  pages: {
    "/items": (ctx) => {
      const targetId = String(ctx.data.targetId)
      return html(`
<h1>Archive</h1>
<ul id="list"></ul>
<div id="sentinel">Loading more…</div>
<form id="answer">
  <label>Code for item ${escape(targetId)} <input id="value" autocomplete="off"></label>
  <button type="submit">Submit code</button>
</form>
<p id="message"></p>
<script>
let offset = 0
let done = false
let loading = false
const list = document.getElementById("list")
const sentinel = document.getElementById("sentinel")
async function load() {
  if (loading || done) return
  loading = true
  const response = await fetch("/api/items?offset=" + offset)
  const data = await response.json()
  for (const item of data.items) {
    const row = document.createElement("li")
    row.textContent = item.id + " - " + item.code
    list.appendChild(row)
  }
  offset += data.items.length
  done = data.items.length < data.batch
  loading = false
  if (done) sentinel.textContent = "End of the archive."
}
new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) load() }).observe(sentinel)
load()
document.getElementById("answer").addEventListener("submit", async (event) => {
  event.preventDefault()
  const value = document.getElementById("value").value.trim()
  const response = await fetch("/api/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }) })
  const data = await response.json().catch(() => ({}))
  document.getElementById("message").textContent = response.ok ? "Recorded." : (data.error || "Not accepted.")
})
</script>`)
    },
  },
  api: {
    "GET /api/items": (ctx, _body, url) => {
      const items = ctx.data.items as Item[]
      const batch = Number(ctx.data.batch)
      const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0)
      return json({ items: items.slice(offset, offset + batch), batch })
    },
    "POST /api/answer": (ctx, body) => {
      const value = String(body?.value ?? "").trim()
      if (!value) return json({ error: "Enter a code." }, 400)
      ctx.record("answer", { value })
      return json({ ok: true })
    },
  },
}
