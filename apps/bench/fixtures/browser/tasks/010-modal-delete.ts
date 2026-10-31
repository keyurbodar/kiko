import { escape, html, json, type Handlers } from "../types"

type Draft = { id: string; title: string }

export const formModal: Handlers = {
  pages: {
    "/drafts": (ctx) => {
      const drafts = ctx.data.drafts as Draft[]
      return html(`
<h1>Drafts</h1>
<ul id="drafts">
  ${drafts.map((draft) => `<li>${escape(draft.title)} <button data-id="${escape(draft.id)}">Delete</button></li>`).join("\n  ")}
</ul>
<div id="modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45)">
  <div style="background:#fff;margin:120px auto;padding:24px;width:360px">
    <p>Delete this draft? This cannot be undone.</p>
    <button id="cancel">Cancel</button>
    <button id="confirm">Confirm delete</button>
  </div>
</div>
<p id="message"></p>
<script>
let pending = null
const modal = document.getElementById("modal")
document.querySelectorAll("#drafts button").forEach((button) => {
  button.addEventListener("click", () => { pending = button.dataset.id; modal.style.display = "block" })
})
document.getElementById("cancel").addEventListener("click", () => { pending = null; modal.style.display = "none" })
document.getElementById("confirm").addEventListener("click", async () => {
  const response = await fetch("/api/drafts/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: pending }) })
  modal.style.display = "none"
  if (response.ok) {
    document.querySelector('[data-id="' + pending + '"]').closest("li").remove()
    document.getElementById("message").textContent = "Draft deleted."
  }
  pending = null
})
</script>`)
    },
  },
  api: {
    "POST /api/drafts/delete": (ctx, body) => {
      const id = String(body?.id ?? "")
      const drafts = ctx.data.drafts as Draft[]
      if (!drafts.some((draft) => draft.id === id)) return json({ error: "missing" }, 404)
      const deleted = Array.isArray(ctx.state.deleted) ? (ctx.state.deleted as string[]) : []
      ctx.record("deleted", [...deleted, id])
      return json({ ok: true })
    },
  },
}
