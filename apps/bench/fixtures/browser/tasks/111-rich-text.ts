import { html, json, type Handlers } from "../types"

export const richText: Handlers = {
  pages: {
    "/note": () =>
      html(`
<h1>Note editor</h1>
<div id="toolbar">
  <button type="button" onclick="format('formatBlock', 'h2')">Heading</button>
  <button type="button" onclick="format('bold')">Bold</button>
  <button type="button" onclick="format('insertUnorderedList')">Bullet list</button>
</div>
<div id="editor" contenteditable="true" style="min-height:200px;border:1px solid #999;padding:12px;margin:12px 0"></div>
<button id="save" type="button">Save note</button>
<p id="message"></p>
<script>
function format(command, value) {
  document.getElementById("editor").focus()
  document.execCommand(command, false, value)
}
document.getElementById("save").addEventListener("click", async () => {
  const body = { html: document.getElementById("editor").innerHTML }
  const response = await fetch("/api/note", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  document.getElementById("message").textContent = response.ok ? "Note saved." : (data.error || "Rejected.")
})
</script>`),
  },
  api: {
    "POST /api/note": (ctx, body) => {
      const value = String(body?.html ?? "").trim()
      if (!value) return json({ error: "The note is empty." }, 400)
      ctx.record("note", { html: value })
      return json({ ok: true })
    },
  },
}
