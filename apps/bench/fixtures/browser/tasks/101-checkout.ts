import { escape, html, json, type Handlers } from "../types"

type Address = { name: string; street: string; city: string; postal: string; email: string }
type Payment = { card: string; expiry: string }

const CUTOFF = { year: 26, month: 10 }

const validEmail = (value: string): boolean => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(value)
const validPostal = (value: string): boolean => /^\d{5}$/.test(value)
const validCard = (value: string): boolean => /^\d{16}$/.test(value)
const validExpiry = (value: string): boolean => {
  const match = /^(\d{2})\/(\d{2})$/.exec(value)
  if (!match) return false
  const month = Number(match[1])
  const year = Number(match[2])
  return month >= 1 && month <= 12 && (year > CUTOFF.year || (year === CUTOFF.year && month > CUTOFF.month))
}

const step = (title: string, fields: string, action: string, next: string): Response =>
  html(`
<h1>${escape(title)}</h1>
<form id="step">
  ${fields}
  <button type="submit">Continue</button>
</form>
<p id="message"></p>
<script>
document.getElementById("step").addEventListener("submit", async (event) => {
  event.preventDefault()
  const body = {}
  for (const element of event.target.elements) if (element.id) body[element.id] = element.value
  const response = await fetch("${action}", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  if (response.ok) location.href = "${next}"
  else document.getElementById("message").textContent = data.error || "Rejected."
})
</script>`)

export const checkout: Handlers = {
  pages: {
    "/checkout/address": (ctx) => {
      const prefill = ctx.data.prefill as Address
      return step(
        "Checkout: address",
        `<label>Full name <input id="name" value="${escape(prefill.name)}"></label>
  <label>Street <input id="street" value="${escape(prefill.street)}"></label>
  <label>City <input id="city" value="${escape(prefill.city)}"></label>
  <label>Postal code <input id="postal" value="${escape(prefill.postal)}"></label>
  <label>Email <input id="email" value="${escape(prefill.email)}"></label>`,
        "/api/checkout/address",
        "/checkout/payment",
      )
    },
    "/checkout/payment": (ctx) => {
      const prefill = ctx.data.prefill as Payment
      return step(
        "Checkout: payment",
        `<label>Card number <input id="card" value="${escape(prefill.card)}"></label>
  <label>Expiry (MM/YY) <input id="expiry" value="${escape(prefill.expiry)}"></label>`,
        "/api/checkout/payment",
        "/checkout/review",
      )
    },
    "/checkout/review": (ctx) => {
      const items = ctx.data.items as Array<{ name: string; priceCents: number; qty: number }>
      const total = items.reduce((sum, item) => sum + item.priceCents * item.qty, 0) / 100
      return html(`
<h1>Checkout: review</h1>
<ul>${items.map((item) => `<li>${escape(item.name)} x ${item.qty} - $${((item.priceCents * item.qty) / 100).toFixed(2)}</li>`).join("")}</ul>
<p>Total: $${total.toFixed(2)}</p>
<button id="place">Place order</button>
<p id="message"></p>
<script>
document.getElementById("place").addEventListener("click", async () => {
  const response = await fetch("/api/checkout/place", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
  const data = await response.json().catch(() => ({}))
  document.getElementById("message").textContent = response.ok ? "Order placed." : (data.error || "Could not place the order.")
})
</script>`)
    },
  },
  api: {
    "POST /api/checkout/address": (ctx, body) => {
      const address = {
        name: String(body?.name ?? "").trim(),
        street: String(body?.street ?? "").trim(),
        city: String(body?.city ?? "").trim(),
        postal: String(body?.postal ?? "").trim(),
        email: String(body?.email ?? "").trim(),
      }
      if (!address.name || !address.street || !address.city) return json({ error: "Fill in every address field." }, 400)
      if (!validPostal(address.postal)) return json({ error: "Postal code must be five digits." }, 400)
      if (!validEmail(address.email)) return json({ error: "Enter a valid email address." }, 400)
      ctx.record("address", address)
      return json({ ok: true })
    },
    "POST /api/checkout/payment": (ctx, body) => {
      const card = String(body?.card ?? "").replace(/\s+/g, "")
      const expiry = String(body?.expiry ?? "").trim()
      if (!validCard(card)) return json({ error: "Card number must be sixteen digits." }, 400)
      if (!validExpiry(expiry)) return json({ error: "Card has expired." }, 400)
      ctx.record("payment", { last4: card.slice(-4), expiry })
      return json({ ok: true })
    },
    "POST /api/checkout/place": (ctx) => {
      if (!ctx.state.address) return json({ error: "Add a delivery address first." }, 409)
      if (!ctx.state.payment) return json({ error: "Add a payment method first." }, 409)
      if (ctx.state.order) return json({ error: "This order was already placed." }, 409)
      const items = ctx.data.items as Array<{ name: string; priceCents: number; qty: number }>
      ctx.record("order", {
        items,
        total: items.reduce((sum, item) => sum + item.priceCents * item.qty, 0) / 100,
        address: ctx.state.address,
        payment: ctx.state.payment,
      })
      return json({ ok: true })
    },
  },
}
