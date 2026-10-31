import { escape, html, json, type Handlers } from "../types"

type Card = { id: string; title: string; column: string }

const boardOf = (ctx: {
  data: Record<string, any>
  state: Record<string, any>
}): { columns: string[]; cards: Card[] } =>
  (ctx.state.board as { columns: string[]; cards: Card[] } | undefined) ?? {
    columns: ctx.data.columns as string[],
    cards: structuredClone(ctx.data.cards as Card[]),
  }

const columnHtml = (column: string, cards: Card[]): string => `
<section class="column" data-column="${escape(column)}" style="display:inline-block;vertical-align:top;width:200px;min-height:180px;border:1px solid #999;padding:8px;margin-right:8px">
  <h2>${escape(column)}</h2>
  ${cards
    .filter((card) => card.column === column)
    .map(
      (card) =>
        `<div class="card" draggable="true" data-id="${escape(card.id)}" style="border:1px solid #666;padding:6px;margin:6px 0;background:#f4f4f4">${escape(card.title)}</div>`,
    )
    .join("")}
</section>`

export const kanbanDrag: Handlers = {
  pages: {
    "/board": (ctx) => {
      const board = boardOf(ctx)
      return html(`
<h1>Board</h1>
<div id="board">${board.columns.map((column) => columnHtml(column, board.cards)).join("")}</div>
<p id="message"></p>
<script>
document.querySelectorAll(".card").forEach((card) => {
  card.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", card.dataset.id))
})
document.querySelectorAll(".column").forEach((column) => {
  column.addEventListener("dragover", (event) => event.preventDefault())
  column.addEventListener("drop", async (event) => {
    event.preventDefault()
    const id = event.dataTransfer.getData("text/plain")
    const response = await fetch("/api/board/move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, column: column.dataset.column }) })
    const data = await response.json().catch(() => ({}))
    if (response.ok) location.reload()
    else document.getElementById("message").textContent = data.error || "Rejected."
  })
})
</script>`)
    },
  },
  api: {
    "POST /api/board/move": (ctx, body) => {
      const board = boardOf(ctx)
      const card = board.cards.find((entry) => entry.id === String(body?.id ?? ""))
      const column = String(body?.column ?? "")
      if (!card) return json({ error: "No such card." }, 404)
      if (!board.columns.includes(column)) return json({ error: "No such column." }, 400)
      card.column = column
      board.cards = [...board.cards.filter((entry) => entry.id !== card.id), card]
      ctx.record("board", board)
      return json({ ok: true })
    },
  },
}
