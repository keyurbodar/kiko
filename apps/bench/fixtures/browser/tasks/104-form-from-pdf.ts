import { json, type Handlers } from "../types"
import { formPage } from "./1xx-common"
import { APPLICANT_FIELDS, applicantLines, pdfDocument, type Applicant } from "./1xx-pdf"

export const formFromPdf: Handlers = {
  pages: {
    "/apply": (ctx) => {
      const applicant = ctx.data.applicant as Applicant
      return formPage(
        "Residency application",
        APPLICANT_FIELDS.map((field) => ({ id: field.id, label: field.label })),
        "/api/apply",
        {
          submit: "Submit application",
          intro: `The values are in the PDF at <a href="/application.pdf">application.pdf</a>. Applicant: ${applicant.fullName}.`,
        },
      )
    },
    "/application.pdf": (ctx) =>
      new Response(pdfDocument(applicantLines(ctx.data.applicant as Applicant)), {
        headers: { "content-type": "application/pdf" },
      }),
  },
  api: {
    "POST /api/apply": (ctx, body) => {
      const application: Record<string, string> = {}
      for (const field of APPLICANT_FIELDS) {
        const value = String(body?.[field.id] ?? "").trim()
        if (!value) return json({ error: `Fill in ${field.label.toLowerCase()}.` }, 400)
        application[field.id] = value
      }
      ctx.record("application", application)
      return json({ ok: true })
    },
  },
}
