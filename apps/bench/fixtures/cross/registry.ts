import { escape, html, json, type Handlers } from "./types"

const region = (ctx: { readonly data: Record<string, any> }): string => String(ctx.data.expectedRegion)

const dashboard: Handlers = {
  pages: {
    "/": (ctx) =>
      html(`
<h1>Deployment dashboard</h1>
<p id="status">Status: DEGRADED</p>
<p data-region="${escape(region(ctx))}">This deployment requires region <strong>${escape(region(ctx))}</strong>.</p>
<p>The service in this environment reports region <strong>${escape(ctx.data.currentRegion)}</strong>.</p>
<p>Fix the service configuration and restart it. This page refreshes when you reload it.</p>`),
  },
  api: {
    "GET /api/status": async (ctx) => {
      try {
        const response = await fetch(`http://127.0.0.1:${ctx.data.servicePort}/health`, {
          signal: AbortSignal.timeout(1500),
        })
        const body = (await response.json()) as { ok?: boolean; region?: string }
        return json({ healthy: body.ok === true && body.region === region(ctx), region: body.region ?? null })
      } catch {
        return json({ healthy: false, region: null })
      }
    },
  },
}

const sales = (ctx: { readonly data: Record<string, any> }): string => String(ctx.data.csv)

const exportCsv: Handlers = {
  pages: {
    "/": (ctx) =>
      html(`
<h1>Sales export</h1>
<p>Download the export, then clean it for accounting.</p>
<p><a id="export" href="/sales.csv">Download sales.csv</a></p>
<pre>${escape(sales(ctx).split("\n").slice(0, 3).join("\n"))}</pre>`),
  },
  api: {
    "GET /sales.csv": (ctx) => new Response(sales(ctx), { headers: { "content-type": "text/csv" } }),
  },
}

const release: Handlers = {
  pages: {
    "/": (ctx) =>
      html(`
<h1>Release ${escape(ctx.data.version)}</h1>
<p data-version="${escape(ctx.data.version)}">Ship version <strong>${escape(ctx.data.version)}</strong>.</p>
<p>Required checks:</p>
<ul>
${(ctx.data.checks as string[]).map((item) => `<li>${escape(item)}</li>`).join("\n")}
</ul>
<form id="release">
  <label>Version <input id="version" name="version" autocomplete="off"></label>
  <label>Artifact hash <input id="hash" name="hash" autocomplete="off"></label>
  <button id="submit" type="submit">Publish release</button>
</form>
<p id="message"></p>
<script>
const form = document.getElementById("release")
const message = document.getElementById("message")
form.addEventListener("submit", async (event) => {
  event.preventDefault()
  const body = Object.fromEntries(new FormData(form))
  const response = await fetch("/api/release", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  message.textContent = response.ok ? "Release published." : "The server rejected the release."
})
</script>`),
  },
  api: {
    "POST /api/release": (ctx, body) => {
      const version = String(body?.version ?? "").trim()
      const hash = String(body?.hash ?? "").trim()
      if (version !== ctx.data.version || hash !== ctx.data.hash) return json({ error: "invalid" }, 400)
      ctx.record("release", { version, hash })
      return json({ ok: true })
    },
    "GET /api/status": (ctx) =>
      json({ released: ctx.state.release?.version === ctx.data.version, release: ctx.state.release ?? null }),
  },
}

const orders: Handlers = {
  pages: {
    "/": (ctx) =>
      html(`
<h1>Orders</h1>
<table>
<tr><th>Order</th><th>Customer</th><th>Status</th><th>Receipt</th></tr>
${(ctx.data.orders as Array<{ id: string; customer: string; status: string; receipt: string }>)
  .map(
    (order) =>
      `<tr><td>${escape(order.id)}</td><td>${escape(order.customer)}</td><td>${escape(order.status)}</td><td>${escape(order.receipt)}</td></tr>`,
  )
  .join("\n")}
</table>
<p>Pending orders are settled by submitting the receipt total.</p>
<form id="settle">
  <label>Order <input id="order" name="order" autocomplete="off"></label>
  <label>Total <input id="total" name="total" autocomplete="off"></label>
  <button id="submit" type="submit">Settle order</button>
</form>
<p id="message"></p>
<script>
const form = document.getElementById("settle")
const message = document.getElementById("message")
form.addEventListener("submit", async (event) => {
  event.preventDefault()
  const body = Object.fromEntries(new FormData(form))
  const response = await fetch("/api/settle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  message.textContent = response.ok ? "Order settled." : "The server rejected the settlement."
})
</script>`),
  },
  api: {
    "POST /api/settle": (ctx, body) => {
      const id = String(body?.order ?? "").trim()
      const total = String(body?.total ?? "").trim()
      const order = (ctx.data.orders as Array<{ id: string; total: string }>).find((entry) => entry.id === id)
      if (!order || order.total !== total) return json({ error: "invalid" }, 400)
      ctx.record("settled", { order: id, total })
      return json({ ok: true })
    },
  },
}

export const registry: Record<string, Handlers> = {
  "cross-001-dashboard-config": dashboard,
  "cross-002-csv-spreadsheet": exportCsv,
  "cross-004-release-checklist": release,
  "cross-005-order-receipt": orders,
}
