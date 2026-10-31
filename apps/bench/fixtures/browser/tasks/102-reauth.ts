import { escape, html, json, type Handlers } from "../types"

export const reauth: Handlers = {
  pages: {
    "/settings": (ctx) => {
      const current = ctx.data.current as { email: string; timezone: string; digest: string }
      return html(`
<h1>Account settings</h1>
<form id="settings">
  <label>Email <input id="email" value="${escape(current.email)}"></label>
  <label>Timezone
    <select id="timezone">
      <option>UTC</option><option>Europe/Berlin</option><option>America/New_York</option><option>Asia/Tokyo</option>
    </select>
  </label>
  <label>Weekly digest
    <select id="digest"><option>off</option><option>on</option></select>
  </label>
  <label id="password-row" style="display:none">Password <input id="password" type="password"></label>
  <button type="submit">Save changes</button>
</form>
<p id="message"></p>
<script>
document.getElementById("timezone").value = "${escape(current.timezone)}"
document.getElementById("digest").value = "${escape(current.digest)}"
document.getElementById("settings").addEventListener("submit", async (event) => {
  event.preventDefault()
  const body = { email: document.getElementById("email").value.trim(), timezone: document.getElementById("timezone").value, digest: document.getElementById("digest").value }
  const password = document.getElementById("password").value
  if (password) body.password = password
  const response = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  if (response.status === 401) {
    document.getElementById("password-row").style.display = "block"
    document.getElementById("message").textContent = data.error || "Confirm your password."
    return
  }
  document.getElementById("message").textContent = response.ok ? "Settings saved." : (data.error || "Rejected.")
})
</script>`)
    },
  },
  api: {
    "POST /api/settings": (ctx, body) => {
      const settings = {
        email: String(body?.email ?? "").trim(),
        timezone: String(body?.timezone ?? "").trim(),
        digest: String(body?.digest ?? "").trim(),
      }
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(settings.email))
        return json({ error: "Enter a valid email address." }, 400)
      if (!settings.timezone || !settings.digest) return json({ error: "Choose every setting." }, 400)
      const password = String(body?.password ?? "")
      if (!password) {
        ctx.record("reauthRequired", true)
        return json({ error: "Enter your password to confirm this change." }, 401)
      }
      if (password !== ctx.data.password) return json({ error: "That password is not correct." }, 403)
      ctx.record("settings", settings)
      return json({ ok: true })
    },
  },
}
