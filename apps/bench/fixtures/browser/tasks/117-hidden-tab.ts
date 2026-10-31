import { escape, html, json, type Handlers } from "../types"

type Question = { id: string; question: string; answer: string }

export const hiddenTab: Handlers = {
  pages: {
    "/dashboard": (ctx) => {
      const target = (ctx.data.questions as Question[]).find((entry) => entry.id === ctx.data.targetId)!
      return html(`
<h1>Dashboard</h1>
<p>This dashboard holds the question for this week and must stay open.</p>
<p>Question: <strong>${escape(target.question)}</strong></p>
<p><a id="survey-link" href="/survey" target="_blank">Open the survey in a new tab</a></p>
<script>
fetch("/api/dashboard/open", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
addEventListener("pagehide", () => { navigator.sendBeacon("/api/dashboard/close", "{}") })
</script>`)
    },
    "/survey": (ctx) =>
      html(`
<h1>Weekly survey</h1>
<form id="survey">
  ${(ctx.data.questions as Question[])
    .map((entry) => `<label>${escape(entry.question)} <input id="${escape(entry.id)}" autocomplete="off"></label>`)
    .join("\n  ")}
  <button type="submit">Send answers</button>
</form>
<p id="message"></p>
<script>
document.getElementById("survey").addEventListener("submit", async (event) => {
  event.preventDefault()
  const answers = {}
  for (const element of event.target.elements) if (element.id) answers[element.id] = element.value.trim()
  const response = await fetch("/api/survey", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answers }) })
  const data = await response.json().catch(() => ({}))
  document.getElementById("message").textContent = response.ok ? "Thanks." : (data.error || "Rejected.")
})
</script>`),
  },
  api: {
    "POST /api/dashboard/open": (ctx) => {
      ctx.record("dashboardLoads", Number(ctx.state.dashboardLoads ?? 0) + 1)
      return json({ ok: true })
    },
    "POST /api/dashboard/close": (ctx) => {
      ctx.record("dashboardClosed", true)
      return json({ ok: true })
    },
    "POST /api/survey": (ctx, body) => {
      const answers = (body?.answers ?? {}) as Record<string, string>
      ctx.record("survey", { answers })
      return json({ ok: true })
    },
  },
}
