import type { ExtensionResult, FileRef } from "@kiko/protocol"
import { useApp } from "../lib/store"
import { readFile } from "./api"

// Architecture section 24.6. The human's way to install an extension written in the chat's files:
// the file header of /extensions/<name>/extension.json offers install, which sends the folder to
// the user's server as a waiting install. The review and the yes happen in settings → extensions.

const TEXT = /\.(?:js|mjs|json|md|txt)$/i

export async function proposeFromFiles(roomId: string, name: string, files: readonly FileRef[]): Promise<ExtensionResult> {
  const dir = `extensions/${name}/`
  const mine = files.filter((f) => f.name.startsWith(dir) && TEXT.test(f.name))
  const manifestFile = mine.find((f) => f.name === `${dir}extension.json`)
  if (!manifestFile) return { ok: false, error: `${dir}extension.json is missing` }
  let manifest: unknown
  const bundled: Record<string, string> = {}
  try {
    for (const f of mine) {
      const { text } = await readFile(roomId, f.id)
      if (f === manifestFile) manifest = JSON.parse(text)
      else bundled[f.name.slice(dir.length)] = text
    }
  } catch (e) {
    return { ok: false, error: e instanceof SyntaxError ? "extension.json is not valid JSON" : "A file did not load" }
  }
  const store = useApp.user()
  if (!store) return { ok: false, error: "Still connecting" }
  return store.extensionOp({ op: "propose", bundle: { manifest, files: bundled }, room: roomId as never })
}
