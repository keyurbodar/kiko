const escapePdf = (text: string): string => text.replace(/[\\()]/g, (character) => `\\${character}`)

export const pdfDocument = (lines: readonly string[]): string => {
  const content = ["BT", "/F1 12 Tf", "72 740 Td", "16 TL"]
  lines.forEach((line, index) => {
    if (index > 0) content.push("T*")
    content.push(`(${escapePdf(line)}) Tj`)
  })
  content.push("ET")
  const stream = content.join("\n")
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  let pdf = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return pdf
}

export type Applicant = {
  fullName: string
  dob: string
  address: string
  city: string
  postal: string
  country: string
  phone: string
  occupation: string
  employer: string
  annualIncome: string
  dependents: string
  maritalStatus: string
}

export const APPLICANT_FIELDS: ReadonlyArray<{ id: keyof Applicant; label: string }> = [
  { id: "fullName", label: "Full name" },
  { id: "dob", label: "Date of birth" },
  { id: "address", label: "Street address" },
  { id: "city", label: "City" },
  { id: "postal", label: "Postal code" },
  { id: "country", label: "Country" },
  { id: "phone", label: "Phone" },
  { id: "occupation", label: "Occupation" },
  { id: "employer", label: "Employer" },
  { id: "annualIncome", label: "Annual income" },
  { id: "dependents", label: "Dependents" },
  { id: "maritalStatus", label: "Marital status" },
]

export const applicantLines = (applicant: Applicant): string[] => [
  "RESIDENCY APPLICATION",
  "",
  ...APPLICANT_FIELDS.map((field) => `${field.label}: ${applicant[field.id]}`),
  "",
  "Sign and date this form in person at the office.",
]
