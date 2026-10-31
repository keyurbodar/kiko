import { html, json, type Handlers } from "../types"

export const formCookie: Handlers = {
  pages: {
    "/subscribe": () =>
      html(`
<h1>Product updates</h1>
<form id="subscribe" style="padding-bottom:220px">
  <label>Email <input id="email" name="email" autocomplete="off"></label>
  <button id="submit" type="submit">Subscribe</button>
</form>
<p id="message"></p>
<div id="banner" style="position:fixed;left:0;right:0;bottom:0;height:200px;background:#222;color:#fff;padding:20px;z-index:10">
  <p>We use cookies to improve this site.</p>
  <button id="accept">Accept cookies</button>
</div>
<script>
const banner = document.getElementById("banner")
document.getElementById("accept").addEventListener("click", async () => {
  await fetch("/api/consent", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
  banner.remove()
})
document.getElementById("subscribe").addEventListener("submit", async (event) => {
  event.preventDefault()
  const email = document.getElementById("email").value
  const response = await fetch("/api/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) })
  document.getElementById("message").textContent = response.ok ? "Subscribed." : "Enter a valid email."
})
</script>`),
  },
  api: {
    "POST /api/consent": (ctx) => {
      ctx.record("consent", true)
      return json({ ok: true })
    },
    "POST /api/subscribe": (ctx, body) => {
      const email = String(body?.email ?? "").trim()
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return json({ error: "invalid" }, 400)
      ctx.record("subscription", { email })
      return json({ ok: true })
    },
  },
}
