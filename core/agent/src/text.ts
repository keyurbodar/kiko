export function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

// For a value inside a double-quoted attribute, where a quote would end the attribute.
export function escapeAttr(text: string): string {
  return escapeXml(text).replaceAll('"', "&quot;")
}
