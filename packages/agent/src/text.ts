/** Escapes `&`, `<`, `>` so text cannot close a tag or forge one inside an XML-like block. */
export function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}
