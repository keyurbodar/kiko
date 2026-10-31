import { escape, html, json, type Handlers } from "../types"

type Invoice = { id: string; customer: string; status: string; amount: number }

export const formSearch: Handlers = {
  pages: {
    "/invoices": (ctx) => {
      const invoices = ctx.data.invoices as Invoice[]
      return html(`
<h1>Invoices</h1>
<label>Search <input id="search" autocomplete="off"></label>
<label>Status
  <select id="status">
    <option value="">all</option>
    <option value="paid">paid</option>
    <option value="overdue">overdue</option>
    <option value="draft">draft</option>
  </select>
</label>
<table id="rows">
  <tr><th>Invoice</th><th>Customer</th><th>Status</th><th>Amount</th></tr>
  ${invoices.map((invoice) => `<tr><td>${escape(invoice.id)}</td><td>${escape(invoice.customer)}</td><td>${escape(invoice.status)}</td><td>${invoice.amount}</td></tr>`).join("\n  ")}
</table>
<form id="answer">
  <label>Invoice number <input id="value" name="value" autocomplete="off"></label>
  <button type="submit">Submit</button>
</form>
<p id="message"></p>
<script>
const rows = Array.from(document.querySelectorAll("#rows tr")).slice(1)
const apply = () => {
  const query = document.getElementById("search").value.toLowerCase()
  const status = document.getElementById("status").value
  for (const row of rows) {
    const cells = row.querySelectorAll("td")
    const match = cells[1].textContent.toLowerCase().includes(query) && (!status || cells[2].textContent === status)
    row.style.display = match ? "" : "none"
  }
}
document.getElementById("search").addEventListener("input", apply)
document.getElementById("status").addEventListener("change", apply)
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
