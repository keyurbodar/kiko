import { escape, html } from "../types"

type Field = {
  readonly id: string
  readonly label: string
  readonly type?: string
  readonly value?: string
  readonly choices?: readonly string[]
  readonly rows?: number
}

const control = (field: Field): string => {
  if (field.choices)
    return `<select id="${escape(field.id)}" name="${escape(field.id)}">${field.choices
      .map((choice) => `<option>${escape(choice)}</option>`)
      .join("")}</select>`
  if (field.rows)
    return `<textarea id="${escape(field.id)}" name="${escape(field.id)}" rows="${field.rows}" cols="52">${escape(field.value ?? "")}</textarea>`
  return `<input id="${escape(field.id)}" name="${escape(field.id)}" type="${escape(field.type ?? "text")}" value="${escape(field.value ?? "")}" autocomplete="off">`
}

const fieldsHtml = (fields: readonly Field[]): string =>
  fields.map((field) => `<label>${escape(field.label)} ${control(field)}</label>`).join("\n  ")

export const formPage = (
  title: string,
  fields: readonly Field[],
  endpoint: string,
  options: { readonly submit?: string; readonly intro?: string } = {},
): Response =>
  html(`
<h1>${escape(title)}</h1>
${options.intro ? `<p>${options.intro}</p>` : ""}
<form id="task-form">
  ${fieldsHtml(fields)}
  <button id="submit" type="submit">${escape(options.submit ?? "Submit")}</button>
</form>
<p id="message"></p>
<script>
document.getElementById("task-form").addEventListener("submit", async (event) => {
  event.preventDefault()
  const body = {}
  for (const element of event.target.elements) if (element.id) body[element.id] = element.value
  const response = await fetch("${endpoint}", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  document.getElementById("message").textContent = response.ok ? (data.message || "Saved.") : (data.error || "Rejected.")
})
</script>`)

export const answerPage = (question: string): Response =>
  formPage("Answer", [{ id: "value", label: question }], "/api/answer", { submit: "Submit answer" })
