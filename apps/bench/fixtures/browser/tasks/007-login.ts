import { escape, html, json, type Handlers } from "../types"

export const formLogin: Handlers = {
  pages: {
    "/login": () =>
      html(`
<h1>Sign in</h1>
<form id="login">
  <label>Username <input id="user" name="user" autocomplete="off"></label>
  <label>Password <input id="password" name="password" type="password"></label>
  <button type="submit">Sign in</button>
</form>
<p id="message"></p>
<script>
document.getElementById("login").addEventListener("submit", async (event) => {
  event.preventDefault()
  const body = { user: document.getElementById("user").value, password: document.getElementById("password").value }
  const response = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  if (!response.ok) { document.getElementById("message").textContent = "Wrong username or password."; return }
  location.href = "/account"
})
</script>`),
    "/account": (ctx) => {
      const token = ctx.state.login ? String(ctx.data.token) : "sign in first"
      return html(`
<h1>Your account</h1>
<p>Access token: <code id="token">${escape(token)}</code></p>
<form id="answer">
  <label>Submit the access token <input id="value" name="value" autocomplete="off"></label>
  <button type="submit">Submit token</button>
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
    "POST /api/login": (ctx, body) => {
      const user = String(body?.user ?? "")
      const password = String(body?.password ?? "")
      if (user !== ctx.data.user || password !== ctx.data.password) return json({ error: "denied" }, 401)
      ctx.record("login", { user })
      return json({ token: ctx.data.token })
    },
    "POST /api/answer": (ctx, body) => {
      const value = String(body?.value ?? "").trim()
      if (!value) return json({ error: "invalid" }, 400)
      ctx.record("answer", { value })
      return json({ ok: true })
    },
  },
}
