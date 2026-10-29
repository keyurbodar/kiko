import * as Schema from "effect/Schema"
import type { ScriptBinding } from "./cloudflare"
import { BUILDER_DIR, type ReleaseBuilder, type ReleaseManifest, type ReleaseMigration } from "./release"

export class ReleasePlanRefused extends Schema.TaggedError<ReleasePlanRefused>()("ReleasePlanRefused", {
  reason: Schema.Literals([
    "no_bindings",
    "bad_bindings",
    "no_migrations",
    "unknown_migration",
    "missing_migration_tag",
    "binding_mismatch",
  ]),
  message: Schema.String,
}) {}

type MigrationPlan = { old_tag?: string; new_tag: string; steps: ReleaseMigration[] }

type ReleaseBindings = { name: string; class_name: string }[]

export type UploadBinding =
  | { readonly type: "plain_text" | "secret_text"; readonly name: string; readonly text: string }
  | { readonly type: "inherit"; readonly name: string }
  | { readonly type: "service"; readonly name: string; readonly service: string }

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

export function selectMigrations(all: ReleaseMigration[], current: { tag: string | null } | null): MigrationPlan {
  const last = all.at(-1)
  if (!last) throw new ReleasePlanRefused({ reason: "no_migrations", message: "The release has no migrations." })
  if (current === null) return { new_tag: last.tag, steps: all }
  if (current.tag === null)
    throw new ReleasePlanRefused({
      reason: "missing_migration_tag",
      message:
        "This backend is deployed, but Cloudflare reports no migration tag for it, so its migration state cannot be determined. Run the installer to repair it.",
    })
  const at = all.findIndex((m) => m.tag === current.tag)
  if (at < 0)
    throw new ReleasePlanRefused({
      reason: "unknown_migration",
      message: `The backend is at migration ${current.tag}, which this release does not know.`,
    })
  return { old_tag: current.tag, new_tag: last.tag, steps: all.slice(at + 1) }
}

export function assertDurableObjects(manifest: ReleaseManifest, existing: ReadonlyArray<ScriptBinding>): void {
  const wanted = releaseBindings(manifest)
  const current = existing.filter((binding) => binding.type === "durable_object_namespace")
  const same =
    wanted.length === current.length &&
    wanted.every((binding) => current.some((c) => c.name === binding.name && c.class_name === binding.class_name))
  if (!same)
    throw new ReleasePlanRefused({
      reason: "binding_mismatch",
      message:
        "The release binds a different Durable Object class than this backend uses. Updating would strand the owner's data. Run the installer.",
    })
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

export const builderScriptName = (mainScript: string) => `${mainScript}-builder`

export const builderBinding = (mainScript: string): UploadBinding => ({
  type: "service",
  name: "BUILDER",
  service: builderScriptName(mainScript),
})

export function builderUploadBody(
  builder: ReleaseBuilder,
  files: Map<string, Uint8Array>,
  existing: { migration_tag?: string } | null,
): FormData {
  const metadata = {
    main_module: builder.main_module,
    compatibility_date: builder.compatibility_date,
    compatibility_flags: builder.compatibility_flags,
    bindings: builder.durable_objects.map((binding) => ({ type: "durable_object_namespace" as const, ...binding })),
    migrations: selectMigrations(
      builder.migrations,
      existing === null ? null : { tag: existing.migration_tag ?? null },
    ),
  }
  const form = new FormData()
  form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }))
  for (const module of builder.modules) {
    const bytes = files.get(`${BUILDER_DIR}/${module.name}`) as Uint8Array<ArrayBuffer>
    form.set(module.name, new Blob([bytes], { type: module.type }), module.name)
  }
  return form
}
