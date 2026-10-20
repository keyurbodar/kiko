export function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

export function escapeAttr(text: string): string {
  return escapeXml(text).replaceAll('"', "&quot;")
}
