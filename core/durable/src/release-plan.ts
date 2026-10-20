// What a release upload carries: bindings, migrations, and the multipart body. The installer and the
// in-place update both build the upload here so they cannot drift apart.

import type { ReleaseManifest, ReleaseMigration } from "./release"

export type MigrationPlan = { old_tag?: string; new_tag: string; steps: ReleaseMigration[] }

const BUCKET = "kiko-files"

const BINDINGS = [
  { type: "durable_object_namespace", name: "OWNER", class_name: "OwnerDO" },
] as const

/**
 * Where file bytes live. "r2" binds the bucket (a new install whose bucket exists). "inherit" keeps the
 * binding the running script has, or none (an update, or a new upload to an existing script). "none"
 * leaves it out: files then live in OwnerDO.
 */
export type FilesBinding = "r2" | "inherit" | "none"

function filesBinding(files: FilesBinding) {
  if (files === "r2") return [{ type: "r2_bucket", name: "FILES", bucket_name: BUCKET }] as const
  if (files === "inherit") return [{ type: "inherit", name: "FILES" }] as const
  return []
}

// Which migration steps to send. A new script sends them all. An existing script sends the steps after the tag
// it already ran. A script at the latest tag sends none.
export function selectMigrations(all: ReleaseMigration[], currentTag: string | null): MigrationPlan {
  const last = all.at(-1)
  if (!last) throw new Error("The release has no migrations.")
  if (currentTag === null) return { new_tag: last.tag, steps: all }
  const at = all.findIndex((m) => m.tag === currentTag)
  if (at < 0) throw new Error(`The backend is at migration ${currentTag}, which this release does not know.`)
  return { old_tag: currentTag, new_tag: last.tag, steps: all.slice(at + 1) }
}

export type SecretBinding = { type: "secret_text"; name: string; text: string }

export function buildMetadata(manifest: ReleaseManifest, migrations: MigrationPlan, secrets: SecretBinding[] | null, files: FilesBinding) {
  return {
    main_module: manifest.main_module,
    compatibility_date: manifest.compatibility_date,
    compatibility_flags: manifest.compatibility_flags,
    bindings: [...BINDINGS, ...filesBinding(files), ...(secrets ?? [])],
    migrations,
    ...(secrets ? {} : { keep_bindings: ["secret_text"] }),
  }
}

export function uploadBody(manifest: ReleaseManifest, files: Map<string, Uint8Array>, metadata: unknown): FormData {
  const form = new FormData()
  form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }))
  for (const module of manifest.modules) {
    form.set(module.name, new Blob([files.get(module.name) as Uint8Array<ArrayBuffer>], { type: module.type }), module.name)
  }
  return form
}
