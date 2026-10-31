import { escape, html, json, type Handlers } from "../types"

type Row = { id: string; name: string; code: string }

const PER_PAGE = 8

export const formPagination: Handlers = {
  pages: {
    "/records": (ctx, url) => {
      const records = ctx.data.records as Row[]
      const pages = Math.ceil(records.length / PER_PAGE)
      const page = Math.min(Math.max(Number(url.searchParams.get("page") ?? "1"), 1), pages)
      const slice = records.slice((page - 1) * PER_PAGE, page * PER_PAGE)
      const links = Array.from({ length: pages }, (_, index) => {
        const number = index + 1
        return number === page ? `<strong>${number}</strong>` : `<a href="/records?page=${number}">${number}</a>`
      }).join(" ")
      return html(`
<h1>Records</h1>
<table>
  <tr><th>ID</th><th>Name</th><th>Code</th></tr>
  ${slice.map((record) => `<tr><td>${escape(record.id)}</td><td>${escape(record.name)}</td><td>${escape(record.code)}</td></tr>`).join("\n  ")}
</table>
<p>Page ${page} of ${pages}: ${links}</p>
<form id="answer">
  <label>Code for record ${escape(ctx.data.targetId)} <input id="value" name="value" autocomplete="off"></label>
  <button type="submit">Submit</button>
</form>
<p id="message"></p>
<script>
document.getElementById("answer").addEventListener("submit", async (event) => {
  event.preventDefault()
  const value = document.getElementById("value").value.trim()
  const response = await fetch("/api/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }) })
  document.getElementById("message").textContent = response.ok ? "Recorded." : "Not accepted."
})
</script>`)
    },
  },
  api: {
    "POST /api/answer": (ctx, body) => {
      const value = String(body?.value ?? "").trim()
      if (!value) return json({ error: "invalid" }, 400)
      ctx.record("answer", { value })
      return json({ ok: true })
    },
  },
}
