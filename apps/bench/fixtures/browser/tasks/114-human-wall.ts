import { escape, html, json, type Handlers } from "../types"

export const humanWall: Handlers = {
  pages: {
    "/signup": (ctx) =>
      html(`
<h1>Newsletter signup</h1>
<form id="signup">
  <label>Name <input id="name" value="${escape(ctx.data.name)}"></label>
  <label>Email <input id="email" value="${escape(ctx.data.email)}"></label>
  <button type="submit">Sign up</button>
</form>
<div id="wall" style="display:none;border:2px solid #b00;padding:16px;margin-top:16px">
  <h2>Verify you are human</h2>
  <p>We need to confirm that you are a person before this form can be sent. Complete the challenge to continue.</p>
  <div style="border:1px dashed #666;padding:24px;text-align:center">Challenge widget</div>
</div>
<p id="message"></p>
<script>
document.getElementById("signup").addEventListener("submit", async (event) => {
  event.preventDefault()
  const body = { name: document.getElementById("name").value.trim(), email: document.getElementById("email").value.trim() }
  const response = await fetch("/api/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  if (response.status === 403) {
    document.getElementById("wall").style.display = "block"
    document.getElementById("message").textContent = data.error
    return
  }
  document.getElementById("message").textContent = response.ok ? "You are signed up." : (data.error || "Rejected.")
})
</script>`),
  },
  api: {
    "POST /api/signup": (ctx) => {
      ctx.record("challenge", { issued: true })
      return json({ error: "Human verification required. Complete the challenge to continue." }, 403)
    },
  },
}
