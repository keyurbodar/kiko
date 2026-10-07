// Ported from t3code (MIT), apps/web/src/openVsxThemes.test.ts. Open VSX is a fake here: each
// test serves a real VSIX built in memory and its real checksum.
import { afterEach, describe, expect, test } from "bun:test"
import { strToU8, zipSync } from "fflate"
import { colorToHex } from "./import"
import { importOpenVsxExtension, searchOpenVsxThemes, type OpenVsxExtension } from "./openvsx"
import { colorsForMode } from "./palette"

const ASSET_ROOT = "https://open-vsx.org/api/demo/theme/1.0.0/file"
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const serve = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => handler(String(input), init)) as typeof fetch
}

const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex")

const extension: OpenVsxExtension = {
  collectionId: "open-vsx:demo.theme",
  id: "demo.theme",
  name: "Demo Theme",
  publisher: "demo",
  description: "",
  downloadCount: 1,
  iconUrl: null,
  sourceUrl: null,
  license: "MIT",
  manifestUrl: `${ASSET_ROOT}/package.json`,
  sha256Url: `${ASSET_ROOT}/demo.theme-1.0.0.sha256`,
  version: "1.0.0",
  vsixUrl: `${ASSET_ROOT}/demo.theme-1.0.0.vsix`,
}

function manifest() {
  return {
    publisher: "demo",
    name: "theme",
    version: "1.0.0",
    license: "MIT" as string | undefined,
    contributes: {
      themes: [
        { label: "Demo Dark", uiTheme: "vs-dark", path: "./themes/demo-dark.json" },
        { label: "Demo Light", uiTheme: "vs", path: "./themes/demo-light.json" },
        { label: "Demo", uiTheme: "vs-dark", path: "./themes/demo.json" },
      ],
    },
  }
}

function vsix(packaged: ReturnType<typeof manifest>): Uint8Array {
  return zipSync({
    "extension/package.json": strToU8(JSON.stringify(packaged)),
    "extension/themes/base.jsonc": strToU8('{\n  // inherited workbench colors\n  "colors": { "editor.foreground": "#eeeeee", "focusBorder": "#8b5cf6", },\n}'),
    "extension/themes/demo-dark.json": strToU8('{ "include": "./base.jsonc", "colors": { "editor.background": "#111111" } }'),
    "extension/themes/demo-light.json": strToU8('{ "colors": { "editor.background": "#fafafa", "editor.foreground": "#222222", "focusBorder": "#8b5cf6" } }'),
    "extension/themes/demo.json": strToU8('{ "colors": { "editor.background": "#181818", "editor.foreground": "#eeeeee" } }'),
  })
}

/** Serves a package: the public manifest is only a hint, the checksummed VSIX is the truth. */
function servePackage(bytes: Uint8Array, checksum = sha256(bytes)) {
  serve((url) => {
    if (url === extension.manifestUrl) return new Response(JSON.stringify({ contributes: { themes: [{ label: "Wrong", path: "./themes/missing.json" }] } }))
    if (url === extension.sha256Url) return new Response(`${checksum}  demo.vsix`)
    return new Response(bytes, { headers: { "Content-Length": String(bytes.byteLength) } })
  })
}

describe("open vsx import", () => {
  test("downloads a verified vsix, reads jsonc includes, and pairs contributed variants", async () => {
    servePackage(vsix(manifest()))
    const themes = await importOpenVsxExtension(extension)
    expect(themes).toHaveLength(2)
    expect(themes.every((t) => /^ovx-[a-z0-9-]+-[0-9a-f]{12}$/.test(t.id))).toBe(true)
    expect(themes.every((t) => t.collection?.id === "open-vsx:demo.theme")).toBe(true)
    const paired = themes.find((t) => colorsForMode(t, "light") && colorsForMode(t, "dark"))!
    expect(paired.label).toBe("Demo")
    expect(colorToHex(paired.colors.canvas)).toBe("#fafafa")
    expect(colorToHex(colorsForMode(paired, "dark")!.canvas)).toBe("#111111")
    // The included file's foreground reached the dark variant.
    expect(colorToHex(colorsForMode(paired, "dark")!.text)).toBe("#eeeeee")

    // Renaming a variant keeps its id, so an update replaces the theme in place.
    const renamed = manifest()
    renamed.contributes.themes[2]!.label = "Renamed Solo"
    servePackage(vsix(renamed))
    expect((await importOpenVsxExtension(extension)).map((t) => t.id)).toEqual(themes.map((t) => t.id))
  })

  test("a package that is not what open vsx advertised is refused", async () => {
    const proprietary = manifest()
    proprietary.license = "Proprietary"
    servePackage(vsix(proprietary))
    await expect(importOpenVsxExtension(extension)).rejects.toThrow("does not match its advertised license")
    const missing = manifest()
    missing.contributes.themes[2]!.path = "./themes/missing.json"
    servePackage(vsix(missing))
    await expect(importOpenVsxExtension(extension)).rejects.toThrow("could not be imported safely")
  })

  test("a package whose checksum does not match is refused", async () => {
    servePackage(vsix(manifest()), "0".repeat(64))
    await expect(importOpenVsxExtension(extension)).rejects.toThrow("integrity check")
  })

  test("cancelling stops the import", async () => {
    const controller = new AbortController()
    const bytes = vsix(manifest())
    serve((url) => {
      if (url === extension.manifestUrl) return new Response(JSON.stringify({ contributes: { themes: [{ path: "./theme.json" }] } }))
      if (url === extension.sha256Url) {
        controller.abort()
        return new Response(sha256(bytes))
      }
      return new Response(bytes)
    })
    await expect(importOpenVsxExtension(extension, controller.signal)).rejects.toMatchObject({ name: "AbortError" })
  })
})

describe("open vsx search", () => {
  test("keeps only color themes under an open-source license", async () => {
    const detail = (name: string, license: string) => ({
      namespace: "demo",
      name,
      displayName: name,
      version: "1.0.0",
      downloadCount: 10,
      license,
      files: { manifest: `${ASSET_ROOT}/${name}/package.json`, sha256: `${ASSET_ROOT}/${name}.sha256`, download: `${ASSET_ROOT}/${name}.vsix` },
    })
    const licenses: Record<string, string> = { open: "MIT", closed: "Proprietary" }
    serve((url, init) => {
      if (url.startsWith("https://open-vsx.org/api/-/search")) {
        expect(new URL(url).searchParams.get("category")).toBe("Themes")
        return new Response(JSON.stringify({ extensions: [{ namespace: "demo", name: "open" }, { namespace: "demo", name: "closed" }] }))
      }
      const name = Object.keys(licenses).find((n) => url.includes(`/${n}`))!
      if (url === `https://open-vsx.org/api/demo/${name}`) return new Response(JSON.stringify(detail(name, licenses[name]!)))
      if (init?.method === "HEAD") return new Response(null, { headers: { "Content-Length": "100" } })
      return new Response(JSON.stringify({ license: licenses[name], contributes: { themes: [{ label: name, path: "./t.json" }] } }))
    })
    const found = await searchOpenVsxThemes("demo")
    expect(found.map((e) => e.id)).toEqual(["demo.open"])
  })
})
