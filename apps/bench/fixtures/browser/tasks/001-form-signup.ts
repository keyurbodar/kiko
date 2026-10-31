import { html, json, type Handlers } from "../types"

export const formSignup: Handlers = {
  pages: {
    "/signup": () =>
      html(`
<h1>Newsletter signup</h1>
<form id="signup">
  <label>Name <input id="name" name="name" autocomplete="off"></label>
  <label>Email <input id="email" name="email" autocomplete="off"></label>
  <label>Postal code <input id="zip" name="zip" autocomplete="off"></label>
  <button id="submit" type="submit">Sign up</button>
</form>
<p id="message"></p>
<script>
const form = document.getElementById("signup")
const message = document.getElementById("message")
form.addEventListener("submit", async (event) => {
  event.preventDefault()
  const body = Object.fromEntries(new FormData(form))
  if (!body.name.trim()) { message.textContent = "Enter your name."; return }
  if (!/^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$/i.test(body.email)) { message.textContent = "Enter a valid email address."; return }
  if (!/^[0-9]{5}$/.test(body.zip)) { message.textContent = "Postal code must be five digits."; return }
  const response = await fetch("/api/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  message.textContent = response.ok ? "You are signed up." : "The server rejected the form."
})
</script>`),
  },
  api: {
    "POST /api/signup": (ctx, body) => {
      const name = String(body?.name ?? "").trim()
      const email = String(body?.email ?? "").trim()
      const zip = String(body?.zip ?? "").trim()
      if (!name || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email) || !/^\d{5}$/.test(zip)) {
        return json({ error: "invalid" }, 400)
      }
      ctx.record("signup", { name, email, zip })
      return json({ ok: true })
    },
  },
}
