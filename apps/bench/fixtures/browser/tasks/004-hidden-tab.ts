import { html, json, type Handlers } from "../types"

export const formHidden: Handlers = {
  pages: {
    "/dashboard": () =>
      html(`
<h1>Dashboard</h1>
<p>Live metrics stay on this page. Leave it open.</p>
<div id="pulse">connected</div>
<script>
fetch("/api/dashboard/open", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
addEventListener("pagehide", () => { navigator.sendBeacon("/api/dashboard/close", "{}") })
</script>`),
    "/survey": () =>
      html(`
<h1>Quick survey</h1>
<form id="survey">
  <label>Rating from 1 to 5 <input id="rating" name="rating" autocomplete="off"></label>
  <button type="submit">Send</button>
</form>
<p id="message"></p>
<script>
document.getElementById("survey").addEventListener("submit", async (event) => {
  event.preventDefault()
  const rating = document.getElementById("rating").value.trim()
  const response = await fetch("/api/survey", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating }) })
  document.getElementById("message").textContent = response.ok ? "Thanks." : "Rating must be 1 to 5."
})
</script>`),
  },
  api: {
    "POST /api/dashboard/open": (ctx) => {
      ctx.record("dashboardOpen", true)
      return json({ ok: true })
    },
    "POST /api/dashboard/close": (ctx) => {
      ctx.record("dashboardClosed", true)
      return json({ ok: true })
    },
    "POST /api/survey": (ctx, body) => {
      const rating = String(body?.rating ?? "").trim()
      if (!/^[1-5]$/.test(rating)) return json({ error: "invalid" }, 400)
      ctx.record("survey", { rating })
      return json({ ok: true })
    },
  },
}
