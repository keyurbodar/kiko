import { describe, expect, it } from "vitest"
import type { FsEntry } from "../../files/file-index"
import { type FilesBackend, RoomFs } from "../../files/room-fs"
import { skillsExtension } from "./skills"

const file = (path: string): FsEntry & { kind: "file" } => ({
  kind: "file",
  path,
  id: path,
  size: 1,
  type: "text/markdown",
  sha256: path,
  r2Key: path,
  at: 0,
})

function room(files: Record<string, string | null>, listFailed = false): RoomFs {
  const backend = {
    list: async () =>
      listFailed
        ? { ok: false as const, code: "not_found" as const, message: "no such folder: home/skills" }
        : Object.keys(files).map(file),
    bytes: async (key: string) => {
      const text = files[key]
      return text == null ? null : new TextEncoder().encode(text)
    },
  } as unknown as FilesBackend
  return new RoomFs("test", backend)
}

function skills(fs: RoomFs): Promise<string> {
  const wrap = skillsExtension(fs).wraps?.[0]
  if (!wrap || !("section" in wrap)) throw new Error("no skills wrap")
  return wrap.wrap({ key: "skills", render: () => "" }).render({} as never, {} as never) as Promise<string>
}

describe("skills section", () => {
  it("names a skill it skipped and why, instead of only logging it", async () => {
    const text = await skills(room({ "home/skills/inbox-triage/SKILL.md": "---\nname: inbox-triage\n---\nbody" }))
    expect(text).toContain("skills skipped")
    expect(text).toContain("inbox-triage: description is required")
  })

  it("names a skill file it could not read", async () => {
    const text = await skills(room({ "home/skills/x/SKILL.md": null }))
    expect(text).toContain("skill x: it could not be read")
  })

  it("says when the skills folder itself could not be read", async () => {
    const text = await skills(room({}, true))
    expect(text).toContain("home/skills could not be read")
  })
})
