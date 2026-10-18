import { fileName, linkTarget } from "@kiko/protocol"

/**
 * A workspace file as text: a link to its path, which the agent reads and the bubble draws as a chip.
 * A folder's link keeps a trailing slash, so it stays a folder after a round trip through markdown.
 */
export function fileRefToken(path: string, folder = false): string {
  const clean = path.replace(/\/+$/, "")
  return `[${fileName(clean).replace(/[[\]\n\\]/g, "")}](${linkTarget(`/${clean}${folder ? "/" : ""}`)})`
}
