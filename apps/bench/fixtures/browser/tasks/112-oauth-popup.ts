import { escape, html, json, type Handlers } from "../types"

export const oauthPopup: Handlers = {
  pages: {
    "/login": (ctx) =>
      html(`
<h1>Console</h1>
<p>Sign in to the console with your Example account.</p>
<button id="sso" type="button">Sign in with Example</button>
<form id="answer">
  <label>Access token <input id="value" autocomplete="off"></label>
  <button type="submit">Submit token</button>
</form>
<p id="message"></p>
<script>
document.getElementById("sso").addEventListener("click", () => window.open("/oauth/authorize", "example-oauth", "width=420,height=560"))
document.getElementById("answer").addEventListener("submit", async (event) => {
  event.preventDefault()
  const value = document.getElementById("value").value.trim()
  const response = await fetch("/api/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }) })
  const data = await response.json().catch(() => ({}))
  document.getElementById("message").textContent = response.ok ? "Signed in." : (data.error || "Rejected.")
})
</script>`),
    "/oauth/authorize": (ctx) =>
      html(`
<h1>Example account</h1>
<p>Authorize the console to read the profile of <strong>${escape(ctx.data.user)}</strong>.</p>
<form id="auth">
  <label>Password <input id="password" type="password" autocomplete="off"></label>
  <button type="submit">Authorize</button>
</form>
<p id="message"></p>
<p id="token"></p>
<script>
document.getElementById("auth").addEventListener("submit", async (event) => {
  event.preventDefault()
  const body = { user: "${escape(ctx.data.user)}", password: document.getElementById("password").value }
  const response = await fetch("/api/oauth/authorize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  if (response.ok) document.getElementById("token").textContent = "Access token: " + data.token
  else document.getElementById("message").textContent = data.error || "Rejected."
})
</script>`),
  },
  api: {
    "POST /api/oauth/authorize": (ctx, body) => {
      const user = String(body?.user ?? "").trim()
      const password = String(body?.password ?? "")
      if (user !== ctx.data.user) return json({ error: "Unknown account." }, 400)
      if (password !== ctx.data.password) return json({ error: "That password is not correct." }, 403)
      ctx.record("authorized", { user })
      return json({ token: ctx.data.token })
    },
    "POST /api/answer": (ctx, body) => {
      const value = String(body?.value ?? "").trim()
      if (!value) return json({ error: "Enter the access token." }, 400)
      ctx.record("answer", { value })
      return json({ ok: true })
    },
  },
}
