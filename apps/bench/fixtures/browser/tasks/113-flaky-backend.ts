import { html, json, type Handlers } from "../types"

export const flakyBackend: Handlers = {
  pages: {
    "/submit": (ctx) =>
      html(`
<h1>Submit the meter reading</h1>
<p>The server is slow today. It may take a few seconds to answer.</p>
<form id="reading">
  <label>Reading <input id="value" value="${String(ctx.data.value)}" autocomplete="off"></label>
  <button type="submit">Submit reading</button>
</form>
<p id="status"></p>
<p id="message"></p>
<script>
document.getElementById("reading").addEventListener("submit", async (event) => {
  event.preventDefault()
  const status = document.getElementById("status")
  const message = document.getElementById("message")
  const button = event.target.querySelector("button")
  button.disabled = true
  message.textContent = ""
  status.textContent = "Sending…"
  await new Promise((resolve) => setTimeout(resolve, 3000))
  const value = document.getElementById("value").value.trim()
  const response = await fetch("/api/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }) })
  const data = await response.json().catch(() => ({}))
  status.textContent = ""
  button.disabled = false
  message.textContent = response.ok ? "Reading recorded." : (data.error || "Something went wrong. Try again.")
})
</script>`),
  },
  api: {
    "POST /api/submit": (ctx, body) => {
      const attempts = Number(ctx.state.attempts ?? 0) + 1
      ctx.state.attempts = attempts
      ctx.save()
      if (attempts === 1) return json({ error: "The meter service did not answer. Try again." }, 500)
      const value = String(body?.value ?? "").trim()
      if (!value) return json({ error: "Enter the reading." }, 400)
      ctx.record("submitted", { value, attempts })
      return json({ ok: true })
    },
  },
}
