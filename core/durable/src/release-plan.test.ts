import { describe, expect, it } from "vitest"
import type { ScriptBinding } from "./cloudflare"
import type { ReleaseManifest } from "./release"
import { assertDurableObjects, ReleasePlanRefused, selectMigrations } from "./release-plan"

const steps = [{ tag: "v1", new_sqlite_classes: ["OwnerDO"] }, { tag: "v2" }, { tag: "v3" }]

const manifest = (durable_objects = [{ name: "OWNER", class_name: "OwnerDO" }]): ReleaseManifest => ({
  version: "1.0.0",
  protocol: 3,
  main_module: "index.js",
  compatibility_date: "2026-09-01",
  compatibility_flags: [],
  durable_objects,
  migrations: steps,
  modules: [{ name: "index.js", type: "application/javascript+module", sha256: "x" }],
})

const doBinding = (name: string, class_name: string): ScriptBinding => ({
  type: "durable_object_namespace",
  name,
  class_name,
})

describe("selectMigrations", () => {
  it("replays every step for a script that does not exist yet", () => {
    expect(selectMigrations(steps, null)).toEqual({ new_tag: "v3", steps })
  })

  it("replays only the steps after the deployed tag", () => {
    expect(selectMigrations(steps, { tag: "v1" })).toEqual({
      old_tag: "v1",
      new_tag: "v3",
      steps: [steps[1], steps[2]],
    })
  })

  it("refuses when the script exists but Cloudflare reports no tag", () => {
    expect(() => selectMigrations(steps, { tag: null })).toThrow(ReleasePlanRefused)
    expect(() => selectMigrations(steps, { tag: null })).toThrow(/cannot be determined/)
  })

  it("refuses a tag this release does not know", () => {
    expect(() => selectMigrations(steps, { tag: "v9" })).toThrow(/does not know/)
  })
})

describe("assertDurableObjects", () => {
  it("accepts the Durable Object bindings the backend already runs", () => {
    const existing = [doBinding("OWNER", "OwnerDO"), { type: "plain_text", name: "OWNER_ID", text: "user" }]
    expect(() => assertDurableObjects(manifest(), existing)).not.toThrow()
  })

  it("refuses a release that binds a different class to the same name", () => {
    expect(() => assertDurableObjects(manifest(), [doBinding("OWNER", "OtherDO")])).toThrow(ReleasePlanRefused)
    expect(() => assertDurableObjects(manifest(), [doBinding("OWNER", "OtherDO")])).toThrow(/strand/)
  })

  it("refuses a release that adds a Durable Object binding", () => {
    expect(() => assertDurableObjects(manifest(), [])).toThrow(/strand/)
  })
})
