import { escape, html, json, type Handlers } from "../types"

type Day = { date: string; disabled: boolean }

export const datePicker: Handlers = {
  pages: {
    "/book": (ctx) => {
      const days = ctx.data.days as Day[]
      return html(`
<h1>Book an appointment</h1>
<p>Pick the first available day. Greyed out days cannot be booked.</p>
<div id="days">${days
        .map(
          (day) =>
            `<button class="day" data-date="${escape(day.date)}" ${day.disabled ? "disabled" : ""} style="margin:4px;padding:8px">${escape(day.date)}</button>`,
        )
        .join("")}</div>
<p id="message"></p>
<script>
document.querySelectorAll(".day").forEach((button) => {
  button.addEventListener("click", async () => {
    const response = await fetch("/api/book", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: button.dataset.date }) })
    const data = await response.json().catch(() => ({}))
    document.getElementById("message").textContent = response.ok ? "Booked for " + button.dataset.date + "." : (data.error || "Rejected.")
  })
})
</script>`)
    },
  },
  api: {
    "POST /api/book": (ctx, body) => {
      const date = String(body?.date ?? "").trim()
      const day = (ctx.data.days as Day[]).find((entry) => entry.date === date)
      if (!day) return json({ error: "Pick a day from the calendar." }, 400)
      if (day.disabled) return json({ error: "That day is not available." }, 400)
      ctx.record("booking", { date })
      return json({ ok: true })
    },
  },
}
