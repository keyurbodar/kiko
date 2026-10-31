import "../index.css"
import { describe, expect, it } from "vitest"
import { page } from "vitest/browser"
import type { ImportedTheme } from "@kiko/theme/imported"
import type { Send } from "@kiko/theme/open-vsx"
import { render } from "../../test/render"
import { look, updateLook } from "./live"
import { ThemeBrowser } from "./open-vsx-themes"

const API = "https://open-vsx.org/api"

function keepLook() {
  const before = look()
  return { [Symbol.dispose]: () => updateLook(before) }
}

function registry(routes: Record<string, unknown>): Send {
  return async (path) => {
    const url = decodeURIComponent(path.replace("/api/open-vsx?url=", ""))
    const key = url.startsWith(`${API}/-/search`) ? "search" : url
    if (!(key in routes)) return new Response("missing", { status: 404 })
    const body = routes[key]
    return new Response(typeof body === "string" ? body : JSON.stringify(body))
  }
}

const monokai = `${API}/monokai/theme-monokai-pro-vscode`
const monokaiFiles = `${monokai}/2.0.16/file`
const monokaiRoutes = {
  search: {
    extensions: [
      {
        namespace: "monokai",
        name: "theme-monokai-pro-vscode",
        displayName: "Monokai Pro",
        downloadCount: 337_018,
        version: "2.0.16",
        files: { icon: `${monokaiFiles}/icon.png` },
      },
    ],
  },
  [`${monokaiFiles}/package.json`]: {
    contributes: { themes: [{ label: "Monokai Pro", uiTheme: "vs-dark", path: "./themes/pro.json" }] },
  },
  [monokai]: {
    version: "2.0.16",
    license: "SEE LICENSE IN LICENSE",
    files: {
      manifest: `${monokaiFiles}/package.json`,
      download: `${monokaiFiles}/x.vsix`,
      sha256: `${monokaiFiles}/x.sha256`,
      license: `${monokaiFiles}/LICENSE.txt`,
    },
  },
  [`${monokaiFiles}/LICENSE.txt`]: "Monokai Pro may not be sub-licensed, resold, or redistributed.",
}

const palette = (chrome: string, base: string, accent: string) => ({
  chrome,
  sidebar: chrome,
  editor: chrome,
  base,
  accent,
  onPrimary: chrome,
  focus: accent,
  success: "#40a02b",
  warn: "#df8e1d",
  danger: "#d20f39",
  red: "#d20f39",
  orange: "#fe640b",
  yellow: "#df8e1d",
  green: "#40a02b",
  cyan: "#04a5e5",
  blue: "#1e66f5",
  magenta: "#ea76cb",
  purple: "#8839ef",
})

const mocha: ImportedTheme = {
  id: "Catppuccin.catppuccin-vsc:extension/themes/mocha.json",
  name: "Catppuccin Mocha",
  source: "Catppuccin.catppuccin-vsc",
  appearance: "dark",
  palette: palette("#1e1e2e", "#cdd6f4", "#cba6f7"),
}
const latte: ImportedTheme = {
  id: "Catppuccin.catppuccin-vsc:extension/themes/latte.json",
  name: "Catppuccin Latte",
  source: "Catppuccin.catppuccin-vsc",
  appearance: "light",
  palette: palette("#eff1f5", "#4c4f69", "#8839ef"),
}

describe("theme browser", () => {
  it("shows a failed install on its own row and never calls that row installed", async () => {
    using _look = keepLook()
    updateLook({ mode: "dark", imported: { themes: [], active: {} } })
    await using _screen = await render(() => <ThemeBrowser open onClose={() => {}} send={registry(monokaiRoutes)} />)
    await page.getByRole("searchbox", { name: "Search Open VSX" }).fill("Monokai Pro")
    const row = page.elementLocator(document.body).getByRole("listitem").filter({ hasText: "Monokai Pro" })
    await expect.element(row.getByText("monokai, 337,018 installs")).toBeVisible()
    await row.getByRole("button", { name: "Install" }).click()

    await expect
      .element(row.getByRole("alert"))
      .toHaveTextContent("Monokai Pro has its own license, and Kiko only imports themes under open licenses like MIT.")
    await expect.element(row.getByText("Installed")).not.toBeInTheDocument()
    await expect.element(row.getByRole("button", { name: "Install" })).not.toBeInTheDocument()
    expect(look().imported.themes).toEqual([])
  })

  it("offers a retry when Open VSX could not be reached during an install", async () => {
    using _look = keepLook()
    updateLook({ mode: "dark", imported: { themes: [], active: {} } })
    const { [monokai]: _detail, ...offline } = monokaiRoutes
    await using _screen = await render(() => <ThemeBrowser open onClose={() => {}} send={registry(offline)} />)
    await page.getByRole("searchbox", { name: "Search Open VSX" }).fill("Monokai")
    const row = page.elementLocator(document.body).getByRole("listitem").filter({ hasText: "Monokai Pro" })
    await row.getByRole("button", { name: "Install" }).click()
    await expect.element(row.getByRole("alert")).toHaveTextContent("Open VSX is unavailable right now. Try again.")
    await expect.element(row.getByRole("button", { name: "Try again" })).toBeVisible()
  })

  it("switches to the light variant picked from its preview", async () => {
    using _look = keepLook()
    updateLook({ mode: "dark", imported: { themes: [mocha, latte], active: { dark: mocha.id } } })
    await using _screen = await render(() => <ThemeBrowser open onClose={() => {}} send={registry({})} />)
    await expect
      .element(page.getByRole("button", { name: "Use Catppuccin Mocha" }))
      .toHaveAttribute("aria-pressed", "true")

    await page.getByRole("button", { name: "Use Catppuccin Latte" }).click()
    expect(look().mode).toBe("light")
    expect(look().imported.active).toEqual({ dark: mocha.id, light: latte.id })
    await expect
      .element(page.getByRole("button", { name: "Use Catppuccin Latte" }))
      .toHaveAttribute("aria-pressed", "true")
    await expect
      .element(page.getByRole("button", { name: "Use Catppuccin Mocha" }))
      .toHaveAttribute("aria-pressed", "false")
  })
})
