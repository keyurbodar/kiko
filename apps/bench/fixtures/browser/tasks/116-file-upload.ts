import { html, json, type Handlers } from "../types"

export const fileUpload: Handlers = {
  pages: {
    "/upload": (ctx) =>
      html(`
<h1>Submit your receipt</h1>
<p>Attach the receipt file from the working directory and describe it.</p>
<form id="upload">
  <label>Receipt file <input id="file" type="file"></label>
  <label>Description <input id="description" autocomplete="off"></label>
  <button type="submit">Upload receipt</button>
</form>
<p id="message"></p>
<script>
document.getElementById("upload").addEventListener("submit", async (event) => {
  event.preventDefault()
  const input = document.getElementById("file")
  if (!input.files.length) { document.getElementById("message").textContent = "Choose a file first."; return }
  const body = new FormData()
  body.append("file", input.files[0])
  body.append("description", document.getElementById("description").value.trim())
  const response = await fetch("/api/upload", { method: "POST", body })
  const data = await response.json().catch(() => ({}))
  document.getElementById("message").textContent = response.ok ? "Receipt received." : (data.error || "Rejected.")
})
</script>`),
  },
  api: {
    "POST /api/upload": async (ctx, body) => {
      if (!(body instanceof FormData)) return json({ error: "Send the form as a file upload." }, 400)
      const file = body.get("file")
      const description = String(body.get("description") ?? "").trim()
      if (!(file instanceof File)) return json({ error: "Attach the receipt file." }, 400)
      if (!description) return json({ error: "Describe the receipt." }, 400)
      ctx.record("upload", { filename: file.name, content: await file.text(), description })
      return json({ ok: true })
    },
  },
}
