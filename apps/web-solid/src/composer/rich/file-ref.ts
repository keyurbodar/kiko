import { fileName, linkTarget } from "@kiko/protocol"

/** A workspace file as text: a link to its path, which the agent reads and the bubble draws as a chip. */
export function fileRefToken(path: string): string {
  return `[${fileName(path).replace(/[[\]\n\\]/g, "")}](${linkTarget(`/${path}`)})`
}
