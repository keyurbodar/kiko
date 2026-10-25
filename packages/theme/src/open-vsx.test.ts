import { describe, expect, it } from "vitest"
import { installTheme, searchThemes, type Send } from "./open-vsx"

const API = "https://open-vsx.org/api"
const encoder = new TextEncoder()

function zip(files: Record<string, string>): Uint8Array {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const [path, text] of Object.entries(files)) {
    const name = encoder.encode(path)
    const data = encoder.encode(text)
    const local = new Uint8Array(30 + name.length + data.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(data, 30 + name.length)
    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const directorySize = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, centrals.length, true)
  ev.setUint16(10, centrals.length, true)
  ev.setUint32(12, directorySize, true)
  ev.setUint32(16, offset, true)
  const out = new Uint8Array(offset + directorySize + 22)
  let at = 0
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at)
    at += part.length
  }
  return out
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice()))
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

type Extension = {
  namespace: string
  name: string
  displayName: string
  downloadCount?: number
  license: string
  licenseText?: string
  manifest: Record<string, unknown>
  files: Record<string, string>
}

async function registry(extensions: Extension[], order: string[] = extensions.map((e) => e.name)) {
  const routes = new Map<string, Uint8Array>()
  const put = (url: string, body: string | Uint8Array) =>
    routes.set(url, typeof body === "string" ? encoder.encode(body) : body)
  const hits: string[] = []
  for (const ext of extensions) {
    const version = String(ext.manifest.version)
    const base = `${API}/${ext.namespace}/${ext.name}/${version}/file`
    const vsix = zip({ "extension/package.json": JSON.stringify(ext.manifest), ...ext.files })
    const files: Record<string, string> = {
      manifest: `${base}/package.json`,
      download: `${base}/${ext.namespace}.${ext.name}-${version}.vsix`,
      sha256: `${base}/${ext.namespace}.${ext.name}-${version}.sha256`,
      icon: `${base}/icon.png`,
    }
    if (ext.licenseText) {
      files.license = `${base}/LICENSE.md`
      put(files.license, ext.licenseText)
    }
    put(`${API}/${ext.namespace}/${ext.name}`, JSON.stringify({ version, license: ext.license, files }))
    put(files.manifest, JSON.stringify(ext.manifest))
    put(files.download, vsix)
    put(files.sha256, `${await sha256(vsix)}  ${ext.namespace}.${ext.name}-${version}.vsix`)
  }
  const searchBody = JSON.stringify({
    extensions: order.map((name) => {
      const ext = extensions.find((e) => e.name === name)!
      const version = String(ext.manifest.version)
      return {
        namespace: ext.namespace,
        name: ext.name,
        displayName: ext.displayName,
        description: "",
        downloadCount: ext.downloadCount ?? 0,
        version,
        files: { icon: `${API}/${ext.namespace}/${ext.name}/${version}/file/icon.png` },
      }
    }),
  })
  const send: Send = async (path) => {
    const url = decodeURIComponent(path.replace("/api/open-vsx?url=", ""))
    hits.push(url)
    if (url.startsWith(`${API}/-/search`)) return new Response(searchBody)
    const body = routes.get(url)
    return body ? new Response(body.slice()) : new Response("missing", { status: 404 })
  }
  return { send, hits }
}

const catppuccinTheme = (name: string, type: string, c: Record<string, string>) =>
  JSON.stringify({
    name,
    type,
    colors: {
      focusBorder: c.accent,
      foreground: c.text,
      disabledForeground: c.faint,
      descriptionForeground: c.text,
      errorForeground: c.red,
      "editor.background": c.base,
      "editor.foreground": c.text,
      "sideBar.background": c.mantle,
      "button.background": c.accent,
      "button.foreground": c.crust,
      "editorWarning.foreground": c.peach,
      "textLink.foreground": c.blue,
    },
    tokenColors: [
      { name: "Comments", scope: ["comment", "punctuation.definition.comment"], settings: { foreground: c.comment } },
      { scope: ["string", "punctuation.definition.string"], settings: { foreground: c.green } },
      { scope: ["keyword", "keyword.operator.word", "storage.type"], settings: { foreground: c.accent } },
      { scope: ["entity.name.function", "support.function"], settings: { foreground: c.blue } },
      { name: "Shell shebang", scope: ["comment.line.shebang"], settings: { foreground: c.pink } },
      { name: "Comment keywords", scope: ["comment meta.annotation.go"], settings: { foreground: c.red } },
    ],
  })

const mocha = {
  base: "#1e1e2e",
  mantle: "#181825",
  crust: "#11111b",
  text: "#cdd6f4",
  faint: "#a6adc8",
  accent: "#cba6f7",
  red: "#f38ba8",
  peach: "#fab387",
  blue: "#89b4fa",
  green: "#a6e3a1",
  pink: "#f5c2e7",
  comment: "#9399b2",
}
const latte = {
  base: "#eff1f5",
  mantle: "#e6e9ef",
  crust: "#dce0e8",
  text: "#4c4f69",
  faint: "#6c6f85",
  accent: "#8839ef",
  red: "#d20f39",
  peach: "#fe640b",
  blue: "#1e66f5",
  green: "#40a02b",
  pink: "#ea76cb",
  comment: "#7c7f93",
}

const catppuccin: Extension = {
  namespace: "Catppuccin",
  name: "catppuccin-vsc",
  displayName: "Catppuccin for VSCode",
  downloadCount: 568_128,
  license: "MIT",
  manifest: {
    name: "catppuccin-vsc",
    publisher: "Catppuccin",
    version: "3.19.0",
    displayName: "Catppuccin for VSCode",
    main: "dist/main.cjs",
    browser: "dist/browser.cjs",
    contributes: {
      themes: [
        { label: "Catppuccin Mocha", uiTheme: "vs-dark", path: "./themes/mocha.json" },
        { label: "Catppuccin Macchiato", uiTheme: "vs-dark", path: "./themes/macchiato.json" },
        { label: "Catppuccin Frappé", uiTheme: "vs-dark", path: "./themes/frappe.json" },
        { label: "Catppuccin Latte", uiTheme: "vs", path: "./themes/latte.json" },
      ],
    },
  },
  files: {
    "extension/themes/mocha.json": catppuccinTheme("Catppuccin Mocha", "dark", mocha),
    "extension/themes/macchiato.json": catppuccinTheme("Catppuccin Macchiato", "dark", mocha),
    "extension/themes/frappe.json": catppuccinTheme("Catppuccin Frappé", "dark", mocha),
    "extension/themes/latte.json": catppuccinTheme("Catppuccin Latte", "light", latte),
    "extension/node_modules/big/data.json": JSON.stringify({ blob: "x".repeat(300 * 1024) }),
  },
}

const catppuccinIcons: Extension = {
  namespace: "Catppuccin",
  name: "catppuccin-vsc-icons",
  displayName: "Catppuccin Icons for VSCode",
  downloadCount: 226_804,
  license: "MIT",
  manifest: {
    name: "catppuccin-vsc-icons",
    publisher: "Catppuccin",
    version: "1.26.0",
    contributes: {
      iconThemes: [{ id: "catppuccin-mocha", label: "Catppuccin Mocha", path: "./dist/mocha.json" }],
    },
  },
  files: {},
}

const tokyoNight: Extension = {
  namespace: "enkia",
  name: "tokyo-night",
  displayName: "Tokyo Night",
  license: "MIT",
  manifest: {
    name: "tokyo-night",
    publisher: "enkia",
    version: "1.1.2",
    contributes: {
      themes: [
        { label: "Tokyo Night", uiTheme: "vs-dark", path: "./themes/tokyo-night-color-theme.json" },
        { label: "Tokyo Night Light", uiTheme: "vs", path: "./themes/tokyo-night-light-color-theme.json" },
      ],
    },
  },
  files: {
    "extension/themes/tokyo-night-color-theme.json": `{
    "name": "Tokyo Night",
    "type": "dark",
    "colors": {
        "editor.background": "#1a1b26",
        "editor.foreground": "#a9b1d6", // main text
    },
}`,
    "extension/themes/tokyo-night-light-color-theme.json": `{
    "name": "Tokyo Night Light",
    "author": "Enkia",
    "type": "dark",
    /* the light variant still says dark here */
    "colors": {
        "editor.background": "#e6e7ed",
        "editor.foreground": "#343b59",
    },
}`,
  },
}

const MIT = `MIT License

Copyright (c) 2018 Sarah Drasner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software.`

const nightOwl: Extension = {
  namespace: "sdras",
  name: "night-owl",
  displayName: "Night Owl",
  license: "SEE LICENSE IN LICENSE.md",
  licenseText: MIT,
  manifest: {
    name: "night-owl",
    publisher: "sdras",
    version: "2.1.1",
    contributes: { themes: [{ label: "Night Owl", uiTheme: "vs-dark", path: "./themes/Night Owl-color-theme.json" }] },
  },
  files: {
    "extension/themes/Night Owl-color-theme.json": JSON.stringify({
      name: "Night Owl",
      type: "dark",
      colors: { "editor.background": "#011627", "editor.foreground": "#d6deeb" },
    }),
  },
}

const monokaiPro: Extension = {
  namespace: "monokai",
  name: "theme-monokai-pro-vscode",
  displayName: "Monokai Pro",
  license: "SEE LICENSE IN LICENSE",
  licenseText: `Copyright (c) 2017-2025 Monokai

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software to use it for the purpose of evaluating the software prior to
purchase.

Monokai Pro may not be sub-licensed, resold, or redistributed.`,
  manifest: {
    name: "theme-monokai-pro-vscode",
    publisher: "monokai",
    version: "2.0.16",
    contributes: { themes: [{ label: "Monokai Pro", uiTheme: "vs-dark", path: "./themes/pro.json" }] },
  },
  files: {
    "extension/themes/pro.json": JSON.stringify({ colors: { "editor.background": "#2d2a2e" } }),
  },
}

const darkPlus: Extension = {
  namespace: "vscode",
  name: "theme-defaults",
  displayName: "Default Themes",
  license: "MIT",
  manifest: {
    name: "theme-defaults",
    publisher: "vscode",
    version: "1.95.3",
    contributes: { themes: [{ label: "%colorTheme.darkPlus%", uiTheme: "vs-dark", path: "./themes/dark_plus.json" }] },
  },
  files: {
    "extension/package.nls.json": JSON.stringify({ "colorTheme.darkPlus": "Dark Modern+" }),
    "extension/themes/dark_vs.json": `{
	"$schema": "vscode://schemas/color-theme",
	"name": "Dark (Visual Studio)",
	"colors": {
		"editor.background": "#1E1E1E",
		"editor.foreground": "#D4D4D4",
	},
	"tokenColors": [
		{ "scope": "comment", "settings": { "foreground": "#6A9955" } },
		{ "scope": "string", "settings": { "foreground": "#CE9178" } },
		{ "scope": "keyword", "settings": { "foreground": "#569CD6" } },
	]
}`,
    "extension/themes/dark_plus.json": `{
	"name": "Dark+",
	"include": "./dark_vs.json",
	"tokenColors": [
		// function names
		{ "scope": ["entity.name.function", "support.function"], "settings": { "foreground": "#DCDCAA" } },
		{ "scope": "keyword.control", "settings": { "foreground": "#C586C0" } },
	]
}`,
  },
}

describe("installTheme", () => {
  it("imports every Catppuccin flavour with its light or dark side and syntax colours", async () => {
    const { send } = await registry([catppuccin])
    const themes = await installTheme(catppuccin, undefined, send)
    expect(themes.map((t) => [t.name, t.appearance])).toEqual([
      ["Catppuccin Mocha", "dark"],
      ["Catppuccin Macchiato", "dark"],
      ["Catppuccin Frappé", "dark"],
      ["Catppuccin Latte", "light"],
    ])
    const mochaTheme = themes[0]!
    expect(mochaTheme.palette.canvas).toBe(mocha.base)
    expect(mochaTheme.accent).toBe(mocha.accent)
    expect(mochaTheme.syntax).toEqual({
      keyword: mocha.accent,
      string: mocha.green,
      func: mocha.blue,
      comment: mocha.comment,
    })
    expect(themes[3]!.syntax?.keyword).toBe(latte.accent)
  })

  it("trusts the manifest's uiTheme over a theme file that names the wrong type", async () => {
    const { send } = await registry([tokyoNight])
    const themes = await installTheme(tokyoNight, undefined, send)
    expect(themes.map((t) => [t.name, t.appearance])).toEqual([
      ["Tokyo Night", "dark"],
      ["Tokyo Night Light", "light"],
    ])
  })

  it("follows includes and layers token colours over the included file", async () => {
    const { send } = await registry([darkPlus])
    const [theme] = await installTheme(darkPlus, undefined, send)
    expect(theme?.name).toBe("Dark Modern+")
    expect(theme?.palette.canvas).toBe("#1e1e1e")
    expect(theme?.syntax).toEqual({ keyword: "#c586c0", string: "#ce9178", func: "#dcdcaa", comment: "#6a9955" })
  })

  it("reads a license named by SEE LICENSE IN and imports when it is MIT", async () => {
    const { send } = await registry([nightOwl])
    const themes = await installTheme(nightOwl, undefined, send)
    expect(themes.map((t) => t.name)).toEqual(["Night Owl"])
  })

  it("refuses a theme under its own commercial license with a message that says so", async () => {
    const { send } = await registry([monokaiPro])
    await expect(installTheme(monokaiPro, undefined, send)).rejects.toThrow(
      "Monokai Pro has its own license, and Kiko only imports themes under open licenses like MIT.",
    )
  })

  it("says an icon theme is an icon theme", async () => {
    const { send } = await registry([catppuccinIcons])
    await expect(installTheme(catppuccinIcons, undefined, send)).rejects.toThrow(
      "Catppuccin Icons for VSCode is a file icon theme, not a color theme.",
    )
  })
})

describe("searchThemes", () => {
  it("drops icon-only extensions and lists each result's variants and icon", async () => {
    const { send } = await registry([catppuccin, catppuccinIcons])
    const found = await searchThemes("Cat", undefined, send)
    expect(found.map((f) => f.name)).toEqual(["catppuccin-vsc"])
    expect(found[0]?.icon).toBe(`${API}/Catppuccin/catppuccin-vsc/3.19.0/file/icon.png`)
    expect(found[0]?.variants).toEqual([
      { label: "Catppuccin Mocha", appearance: "dark" },
      { label: "Catppuccin Macchiato", appearance: "dark" },
      { label: "Catppuccin Frappé", appearance: "dark" },
      { label: "Catppuccin Latte", appearance: "light" },
    ])
  })

  it("never shows a localization placeholder as a variant name", async () => {
    const { send } = await registry([darkPlus])
    const [found] = await searchThemes("default", undefined, send)
    expect(found?.variants).toEqual([{ label: "Default Themes", appearance: "dark" }])
  })

  it("puts results whose name matches the query ahead of loose relevance matches", async () => {
    const { send, hits } = await registry([tokyoNight, nightOwl], ["tokyo-night", "night-owl"])
    const found = await searchThemes("night owl", undefined, send)
    expect(found.map((f) => f.name)).toEqual(["night-owl", "tokyo-night"])
    expect(new URL(hits[0]!).searchParams.get("sortBy")).toBe("relevance")
  })
})
