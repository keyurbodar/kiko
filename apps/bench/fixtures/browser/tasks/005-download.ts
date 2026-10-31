import { html, json, type Handlers } from "../types"

export const formDownload: Handlers = {
  pages: {
    "/reports": () =>
      html(`
<h1>Sales reports</h1>
<p><a id="csv" href="/sales.csv" download="sales.csv">Download sales.csv</a></p>
<form id="answer">
  <label>Total sales <input id="value" name="value" autocomplete="off"></label>
  <button type="submit">Submit total</button>
</form>
<p id="message"></p>
<script>
document.getElementById("answer").addEventListener("submit", async (event) => {
  event.preventDefault()
  const value = document.getElementById("value").value.trim()
  const response = await fetch("/api/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }) })
  document.getElementById("message").textContent = response.ok ? "Recorded." : "That is not the total."
})
</script>`),
  },
  api: {
    "GET /sales.csv": (ctx) => {
      const rows = ctx.data.rows as Array<{ region: string; cents: number }>
      const lines = ["region,amount", ...rows.map((row) => `${row.region},${(row.cents / 100).toFixed(2)}`)]
      return new Response(`${lines.join("\n")}\n`, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="sales.csv"',
        },
      })
    },
    "POST /api/answer": (ctx, body) => {
      const value = String(body?.value ?? "").trim()
      if (!/^\d+(\.\d+)?$/.test(value)) return json({ error: "invalid" }, 400)
      ctx.record("answer", { value })
      return json({ ok: true })
    },
  },
}
