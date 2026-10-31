import { escape, html, json, type Handlers } from "../types"

export const formTable: Handlers = {
  pages: {
    "/team": (ctx) => {
      const people = ctx.data.people as Array<{ name: string; email: string; salary: number }>
      return html(`
<h1>Team directory</h1>
<table>
  <tr><th>Name</th><th>Email</th><th>Salary</th></tr>
  ${people.map((person) => `<tr><td>${escape(person.name)}</td><td>${escape(person.email)}</td><td>${person.salary}</td></tr>`).join("\n  ")}
</table>
<form id="answer">
  <label>Email of the highest paid person <input id="value" name="value" autocomplete="off"></label>
  <button type="submit">Submit</button>
</form>
<p id="message"></p>
<script>
document.getElementById("answer").addEventListener("submit", async (event) => {
  event.preventDefault()
  const value = document.getElementById("value").value.trim()
  const response = await fetch("/api/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }) })
  document.getElementById("message").textContent = response.ok ? "Recorded." : "Not accepted."
})
</script>`)
    },
  },
  api: {
    "POST /api/answer": (ctx, body) => {
      const value = String(body?.value ?? "").trim()
      if (!value) return json({ error: "invalid" }, 400)
      ctx.record("answer", { value })
      return json({ ok: true })
    },
  },
}
