import { describe, expect, test } from "bun:test"
import type { ReleaseManifest } from "./release"
import { type FilesBinding, type MigrationPlan, buildMetadata, selectMigrations } from "./release-plan"

const all = [
  { tag: "v1", new_sqlite_classes: ["UserDO", "RoomDO", "AgentDO"] },
  { tag: "v2", new_sqlite_classes: ["WorkDO"] },
  { tag: "v3", deleted_classes: ["WorkDO"] },
]

describe("selectMigrations", () => {
  test.each<[string, string | null, MigrationPlan]>([
    ["first install sends every step", null, { new_tag: "v3", steps: all }],
    ["update from v1 sends the later steps", "v1", { old_tag: "v1", new_tag: "v3", steps: all.slice(1) }],
    ["already at latest sends no steps", "v3", { old_tag: "v3", new_tag: "v3", steps: [] }],
  ])("%s", (_name, current, expected) => {
    expect(selectMigrations(all, current)).toEqual(expected)
  })

  test("an unknown current tag is an error, not a guess", () => {
    expect(() => selectMigrations(all, "v9")).toThrow()
  })
})

describe("buildMetadata", () => {
  const manifest = { main_module: "index.js", compatibility_date: "2026-09-01", compatibility_flags: ["nodejs_compat"] } as ReleaseManifest
  const plan = selectMigrations(all, null)

  test("first install carries secrets and no keep_bindings", () => {
    const meta = buildMetadata(manifest, plan, [{ type: "secret_text", name: "OWNER_ID", text: "u" }], "r2")
    expect(meta.bindings.map((b) => b.name)).toEqual(["USER", "ROOM", "AGENT", "FILE", "FILES", "OWNER_ID"])
    expect("keep_bindings" in meta).toBe(false)
  })

  test("update keeps secrets and sends none", () => {
    const meta = buildMetadata(manifest, plan, null, "inherit")
    expect(meta).toMatchObject({ keep_bindings: ["secret_text"] })
    expect(meta.bindings.some((b) => b.type === "secret_text")).toBe(false)
  })

  test.each<[FilesBinding, unknown[]]>([
    ["r2", [{ type: "r2_bucket", name: "FILES", bucket_name: "kiko-files" }]],
    ["inherit", [{ type: "inherit", name: "FILES" }]],
    ["none", []],
  ])("files %s", (files, expected) => {
    const meta = buildMetadata(manifest, plan, null, files)
    expect(meta.bindings.filter((b) => b.name === "FILES") as unknown[]).toEqual(expected)
    expect(meta.bindings.some((b) => b.name === "FILE" && b.type === "durable_object_namespace")).toBe(true)
  })
})
