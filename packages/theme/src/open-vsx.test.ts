import { afterEach, describe, expect, test } from "bun:test"
import { zipOf } from "../test/zip-writer"
import { installTheme } from "./open-vsx"

const BASE = "https://open-vsx.org/api/acme/night"
const FILES = `${BASE}/1.0.0/file`
const theme = { colors: { "editor.background": "#101820", "editor.foreground": "#e0e0e0" }, type: "dark" }

type Parts = { license?: string; publisher?: string; checksum?: string }

async function serve({ license = "MIT", publisher = "acme", checksum }: Parts = {}) {
  const vsix = await zipOf([
    { name: "extension/package.json", data: JSON.stringify({ publisher, name: "night", version: "1.0.0" }) },
    { name: "extension/themes/night.json", data: JSON.stringify(theme), deflate: true },
  ])
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", vsix))].map((b) => b.toString(16).padStart(2, "0")).join("")
  const responses: Record<string, string | Uint8Array> = {
    [BASE]: JSON.stringify({ namespace: "acme", name: "night", version: "1.0.0", license, files: { manifest: `${FILES}/package.json`, download: `${FILES}/night.vsix`, sha256: `${FILES}/sha256` } }),
    [`${FILES}/package.json`]: JSON.stringify({ contributes: { themes: [{ label: "Night", path: "./themes/night.json" }] } }),
    [`${FILES}/night.vsix`]: vsix,
    [`${FILES}/sha256`]: checksum ?? digest,
  }
  globalThis.fetch = (async (input: string | URL) => {
    const url = decodeURIComponent(String(input).split("url=")[1]!)
    const body = responses[url]
    return body === undefined ? new Response("missing", { status: 404 }) : new Response(body)
  }) as typeof fetch
}

const item = { namespace: "acme", name: "night", displayName: "Night", description: "", downloadCount: 1 }
const original = globalThis.fetch
afterEach(() => {
  globalThis.fetch = original
})

describe("installTheme", () => {
  test("maps each theme in a verified package to a palette", async () => {
    await serve()
    const themes = await installTheme(item)
    expect(themes.map((t) => [t.name, t.appearance, t.source, t.palette.canvas])).toEqual([["Night", "dark", "acme.night", "#101820"]])
  })

  test("refuses a package whose checksum does not match", async () => {
    await serve({ checksum: "0".repeat(64) })
    await expect(installTheme(item)).rejects.toThrow("integrity check")
  })

  test("refuses a license that is not on the allowed list", async () => {
    await serve({ license: "GPL-3.0" })
    await expect(installTheme(item)).rejects.toThrow("license")
  })

  test("refuses a package whose publisher does not match the listing", async () => {
    await serve({ publisher: "mallory" })
    await expect(installTheme(item)).rejects.toThrow("does not match")
  })
})
