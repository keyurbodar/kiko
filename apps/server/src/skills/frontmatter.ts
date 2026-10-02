import { parse } from "yaml"

// The same frontmatter rules as pi's coding agent (refs/pi/packages/coding-agent/src/utils/frontmatter.ts):
// a leading `---` block of YAML, then the body. A file with no block has empty frontmatter.

export function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const text = content.replace(/^﻿/, "").replace(/\r\n?/g, "\n")
  if (!text.startsWith("---")) return { frontmatter: {}, body: text }
  const end = text.indexOf("\n---", 3)
  if (end === -1) return { frontmatter: {}, body: text }
  const parsed = parse(text.slice(4, end)) as unknown
  return { frontmatter: parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}, body: text.slice(end + 4).trim() }
}
