import { escape, html, json, type Handlers } from "../types"

const ordersPage = (orders: ReadonlyArray<{ id: string; customer: string; total: number }>): Response =>
  html(`
<h1>Orders</h1>
<table>
  <tr><th>Order</th><th>Customer</th><th>Total</th></tr>
  ${orders.map((order) => `<tr><td>${escape(order.id)}</td><td>${escape(order.customer)}</td><td>${order.total.toFixed(2)}</td></tr>`).join("\n  ")}
</table>
<p><a href="/claim">Open the claims form</a></p>`)

export const formTabs: Handlers = {
  pages: {
    "/orders": (ctx) => ordersPage(ctx.data.orders),
    "/claim": () =>
      html(`
<h1>Claim an order</h1>
<form id="claim">
  <label>Order number <input id="order" name="order" autocomplete="off"></label>
  <label>Reason <textarea id="reason" name="reason" rows="3" cols="50"></textarea></label>
  <button type="submit">Submit claim</button>
</form>
<p id="message"></p>
<script>
document.getElementById("claim").addEventListener("submit", async (event) => {
  event.preventDefault()
  const body = { order: document.getElementById("order").value.trim(), reason: document.getElementById("reason").value.trim() }
  const response = await fetch("/api/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  document.getElementById("message").textContent = response.ok ? "Claim received." : "No such order."
})
</script>`),
  },
  api: {
    "POST /api/claim": (ctx, body) => {
      const order = String(body?.order ?? "").trim()
      const reason = String(body?.reason ?? "").trim()
      const known = (ctx.data.orders as Array<{ id: string }>).some((entry) => entry.id === order)
      if (!known || !reason) return json({ error: "invalid" }, 400)
      ctx.record("claim", { order, reason })
      return json({ ok: true })
    },
  },
}
