import * as Schema from "effect/Schema"
import type { ScriptBinding } from "./cloudflare"
import type { ReleaseManifest, ReleaseMigration } from "./release"

export class ReleasePlanRefused extends Schema.TaggedError<ReleasePlanRefused>()("ReleasePlanRefused", {
  reason: Schema.Literals(["no_bindings", "bad_bindings", "no_migrations", "unknown_migration"]),
  message: Schema.String,
}) {}

type MigrationPlan = { old_tag?: string; new_tag: string; steps: ReleaseMigration[] }

type ReleaseBindings = { name: string; class_name: string }[]

export type UploadBinding =
  | { readonly type: "plain_text" | "secret_text"; readonly name: string; readonly text: string }
  | { readonly type: "inherit"; readonly name: string }

const SHIPPED_IN_RELEASE: ReadonlySet<string> = new Set(["CLERK_JWT_KEY", "TRUSTED_ORIGINS", "RELEASE_BASE_URL"])

function releaseBindings(manifest: ReleaseManifest): ReleaseBindings {
  if (
    !("durable_objects" in manifest) ||
    !Array.isArray(manifest.durable_objects) ||
    !manifest.durable_objects.length
  ) {
    throw new ReleasePlanRefused({
      reason: "no_bindings",
      message: "This release has no signed Durable Object bindings. Use the installer for the OwnerDO upgrade.",
    })
  }
  return manifest.durable_objects.map((binding: unknown) => {
    if (
      !binding ||
      typeof binding !== "object" ||
      !("name" in binding) ||
      typeof binding.name !== "string" ||
      !("class_name" in binding) ||
      typeof binding.class_name !== "string"
    )
      throw new ReleasePlanRefused({
        reason: "bad_bindings",
        message: "The release has invalid Durable Object bindings.",
      })
    return { name: binding.name, class_name: binding.class_name }
  })
}

export function selectMigrations(all: ReleaseMigration[], currentTag: string | null): MigrationPlan {
  const last = all.at(-1)
  if (!last) throw new ReleasePlanRefused({ reason: "no_migrations", message: "The release has no migrations." })
  if (currentTag === null) return { new_tag: last.tag, steps: all }
  const at = all.findIndex((m) => m.tag === currentTag)
  if (at < 0)
    throw new ReleasePlanRefused({
      reason: "unknown_migration",
      message: `The backend is at migration ${currentTag}, which this release does not know.`,
    })
  return { old_tag: currentTag, new_tag: last.tag, steps: all.slice(at + 1) }
}

export function keptBindings(
  existing: ReadonlyArray<ScriptBinding>,
  written: ReadonlyArray<UploadBinding>,
): UploadBinding[] {
  const names = new Set(written.map((binding) => binding.name))
  const kept = existing.filter(
    (binding) =>
      binding.type !== "durable_object_namespace" && !names.has(binding.name) && !SHIPPED_IN_RELEASE.has(binding.name),
  )
  return [...written, ...kept.map((binding) => ({ type: "inherit" as const, name: binding.name }))]
}

export function buildMetadata(
  manifest: ReleaseManifest,
  migrations: MigrationPlan,
  bindings: ReadonlyArray<UploadBinding>,
) {
  return {
    main_module: manifest.main_module,
    compatibility_date: manifest.compatibility_date,
    compatibility_flags: manifest.compatibility_flags,
    bindings: [
      ...releaseBindings(manifest).map((binding) => ({ type: "durable_object_namespace" as const, ...binding })),
      ...bindings,
    ],
    migrations,
  }
}

export function uploadBody(manifest: ReleaseManifest, files: Map<string, Uint8Array>, metadata: unknown): FormData {
  const form = new FormData()
  form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }))
  for (const module of manifest.modules) {
    form.set(
      module.name,
      new Blob([files.get(module.name) as Uint8Array<ArrayBuffer>], { type: module.type }),
      module.name,
    )
  }
  return form
}
