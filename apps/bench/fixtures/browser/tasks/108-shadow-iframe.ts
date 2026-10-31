import { escape, html, json, type Handlers } from "../types"

export const shadowIframe: Handlers = {
  pages: {
    "/verify": () =>
      html(`
<h1>Verify your account</h1>
<p>The sign-in widget is in a shadow root. The verification code is shown in the frame below.</p>
<credential-widget></credential-widget>
<iframe id="frame" width="360" height="80" title="Verification code"></iframe>
<p id="message"></p>
<script>
const host = document.querySelector("credential-widget")
const root = host.attachShadow({ mode: "open" })
root.innerHTML = '<form id="f"><label>User <input id="user"></label> <label>Code <input id="code"></label> <button type="submit">Verify</button></form>'
root.getElementById("f").addEventListener("submit", async (event) => {
  event.preventDefault()
  const body = { user: root.getElementById("user").value.trim(), code: root.getElementById("code").value.trim() }
  const response = await fetch("/api/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  document.getElementById("message").textContent = response.ok ? "Account verified." : (data.error || "Rejected.")
})
document.getElementById("frame").src = "http://127.0.0.2:" + location.port + "/code"
</script>`),
    "/code": (ctx) => html(`<p>Verification code: <strong>${escape(ctx.data.code)}</strong></p>`),
  },
  api: {
    "POST /api/verify": (ctx, body) => {
      const user = String(body?.user ?? "").trim()
      const code = String(body?.code ?? "").trim()
      if (!user || !code) return json({ error: "Fill in the user and the code." }, 400)
      if (user !== ctx.data.user) return json({ error: "Unknown user." }, 400)
      if (code !== ctx.data.code) return json({ error: "That code is not correct." }, 400)
      ctx.record("verify", { user, code })
      return json({ ok: true })
    },
  },
}
