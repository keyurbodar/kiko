import { parse } from "yaml"

export type Frontmatter = { frontmatter: Record<string, unknown>; body: string }

export function parseFrontmatter(content: string): Frontmatter {
  const text = content.replace(/^﻿/, "").replace(/\r\n?/g, "\n")
  if (!text.startsWith("---")) return { frontmatter: {}, body: text }
  const end = text.indexOf("\n---", 3)
  if (end === -1) return { frontmatter: {}, body: text }
  const parsed = parse(text.slice(4, end)) as unknown
  return {
    frontmatter: parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {},
    body: text.slice(end + 4).trim(),
  }
}
