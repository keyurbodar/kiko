import { describe, expect, it } from "vitest"
import { kikoDocsBackend } from "./kiko-docs"

const paths = (out: Awaited<ReturnType<ReturnType<typeof kikoDocsBackend>["list"]>>) =>
  Array.isArray(out) ? out.map((e) => `${e.kind === "directory" ? "dir" : "file"} ${e.path}`) : out.code

describe("kiko docs", () => {
  it("lists the top level with the built-in recipes as a folder", async () => {
    const top = paths(await kikoDocsBackend().list("", false))
    expect(top).toContain("dir recipes")
    expect(top).toContain("file index.md")
    expect(top).not.toContain("dir skills")
  })

  it("lists and reads a nested built-in recipe", async () => {
    const docs = kikoDocsBackend()
    expect(paths(await docs.list("recipes/daily-weather", false))).toEqual(["file recipes/daily-weather/RECIPE.md"])
    const file = await docs.stat("recipes/daily-weather/RECIPE.md")
    const bytes = file?.kind === "file" ? await docs.bytes(file.r2Key) : null
    expect(new TextDecoder().decode(bytes ?? new Uint8Array())).toContain("name: daily-weather")
    expect(await docs.stat("recipes/daily-weather")).toMatchObject({ kind: "directory", files: 1 })
  })

  it("answers not found for a folder that does not exist", async () => {
    expect(paths(await kikoDocsBackend().list("skills/haiku", false))).toBe("not_found")
  })
})
