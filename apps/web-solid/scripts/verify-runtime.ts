import assert from "node:assert/strict"
import { chromium, type Browser, type BrowserContext, type Page } from "playwright"

const arg = process.argv.indexOf("--url")
const origin = new URL(arg < 0 ? "http://localhost:8787" : process.argv[arg + 1]).origin
assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname), "Runtime verification requires a local development Worker serving the production build")
const failures = new Set<string>()

function observe(page: Page): void {
  page.on("pageerror", (error) => failures.add(error.stack ?? error.message))
  page.on("console", (message) => {
    if (message.type() === "error") failures.add(message.text())
  })
  page.on("response", (response) => {
    if (response.status() >= 400) failures.add(`HTTP ${response.status()} ${response.url()}`)
  })
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") failures.add(`${request.failure()?.errorText} ${request.url()}`)
  })
}

async function healthy(page: Page, label: string): Promise<void> {
  assert.equal(await page.evaluate(() => document.activeElement ? getComputedStyle(document.activeElement).outlineStyle : "none"), "none", `${label} shows a focus outline`)
  assert.equal(await page.locator('[data-component="crash"]').count(), 0, `${label} crashed`)
  assert.equal(await page.locator("#boot").count(), 0, `${label} never started`)
  assert.equal(await page.locator("#boot-error:visible").count(), 0, `${label} failed to load`)
  assert.deepEqual([...failures], [], `${label} emitted runtime errors`)
  console.log(`pass ${label}`)
}

async function signedIn(browser: Browser, mobile: boolean): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 } })
  const response = await context.request.post(`${origin}/api/auth/dev/session`, { data: { name: "web-runtime" } })
  assert(response.ok(), "Start the local Worker with NODE_ENV=development")
  const { user, token } = await response.json()
  const settings = await context.request.post(`${origin}/api/settings`, { headers: { authorization: `Bearer ${token}` }, data: { onboarded: true } })
  assert(settings.ok(), "Could not complete onboarding")
  await context.addInitScript(({ user, token }) => {
    localStorage.setItem("kiko:session", JSON.stringify(user))
    localStorage.setItem("kiko:token", token)
  }, { user, token })
  return context
}

async function visit(page: Page, path: string): Promise<void> {
  const response = await page.goto(`${origin}${path}`)
  assert(response?.ok(), `${path} returned HTTP ${response?.status()}`)
  assert(await page.locator('script[type="module"][src^="/assets/"]').count(), "Verify the production build, not the Vite development server")
  await page.locator('[data-component="app-shell"]').waitFor()
  await page.locator('[data-component="prompt-input"]').waitFor()
}

async function settingsPages(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const dialog = page.locator('[data-component="settings"]')
  await dialog.waitFor()
  for (const name of ["Models", "Tools", "Appearance", "General", "Keyboard shortcuts", "Account"]) {
    await dialog.getByRole("button", { name, exact: true }).click()
    await dialog.getByRole("heading", { name, exact: true, level: 1 }).waitFor()
    await healthy(page, `settings ${name}`)
  }
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
}

async function search(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Search messages", exact: true }).click()
  const input = page.getByRole("textbox", { name: "Search messages", exact: true })
  await input.fill("runtime verification")
  await page.getByText("No messages found", { exact: true }).waitFor()
  await healthy(page, "message search")
  await page.keyboard.press("Escape")
  await input.waitFor({ state: "hidden" })
}

async function interactions(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New chat", exact: true }).click()
  await page.locator('[data-component="bot-picker"]').waitFor()
  await healthy(page, "new chat picker")
  await page.getByText("New agent", { exact: true }).click()
  const agent = page.locator('[data-component="new-agent"]')
  await agent.waitFor()
  await agent.getByRole("textbox", { name: "Name", exact: true }).fill("Runtime scout")
  await agent.getByRole("textbox", { name: "What should it do?", exact: true }).fill("Check runtime behavior")
  await agent.getByRole("button", { name: "Shuffle", exact: true }).click()
  await healthy(page, "new agent form and avatar picker")
  await agent.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.keyboard.press("Escape")
  const prompt = page.locator('[data-component="prompt-input"]')
  await prompt.fill("A draft that survives refresh")
  await page.waitForTimeout(1500)
  await page.reload()
  await prompt.waitFor()
  await page.waitForFunction(() => document.querySelector('[data-component="prompt-input"]')?.textContent === "A draft that survives refresh")
  await healthy(page, "draft restored after refresh")
  await prompt.fill("")
  await page.getByRole("button", { name: "Emoji", exact: true }).click()
  await page.locator('[data-component="emoji-picker"]').waitFor()
  await healthy(page, "emoji picker")
  await page.keyboard.press("Escape")
}

async function cacheHeaders(page: Page): Promise<void> {
  for (const path of ["/", "/chat/00000000-0000-7000-8000-6b696b6f0000"]) {
    const response = await page.request.get(`${origin}${path}`)
    assert(response.ok())
    assert.match(response.headers()["cache-control"] ?? "", /max-age=0/)
    assert.match(response.headers()["cache-control"] ?? "", /must-revalidate/)
  }
  const asset = await page.locator('script[type="module"][src^="/assets/"]').getAttribute("src")
  assert(asset)
  const response = await page.request.get(`${origin}${asset}`)
  assert.match(response.headers()["cache-control"] ?? "", /immutable/)
  const missing = await page.request.get(`${origin}/assets/missing-old-release.js`)
  assert.equal(missing.status(), 404)
  assert.match(missing.headers()["cache-control"] ?? "", /no-store/)
  console.log("pass release cache headers and missing chunk response")
}

async function surfaces(page: Page): Promise<void> {
  const sidecar = page.locator('[data-component="sidecar"]')
  for (const kind of ["routines", "files", "memory"]) {
    await sidecar.getByRole("button", { name: "Open a surface", exact: true }).click()
    await page.locator(`[role="menuitem"][data-action="open-${kind}"]`).click()
    await sidecar.getByRole("tab", { name: new RegExp(kind, "i") }).waitFor()
    await healthy(page, `${kind} sidecar tab`)
  }
  await sidecar.getByRole("textbox", { name: "Add a memory" }).click()
  await healthy(page, "focused memory input")
}

async function verifyDesktop(browser: Browser): Promise<void> {
  const context = await signedIn(browser, false)
  try {
    const page = await context.newPage()
    observe(page)
    await visit(page, "/")
    await page.getByRole("button", { name: "Settings", exact: true }).hover()
    await page.locator('[data-component="tooltip-v2"]').waitFor()
    await healthy(page, "startup and deferred tooltip")
    await cacheHeaders(page)
    await settingsPages(page)
    await search(page)
    await interactions(page)
    for (const section of ["models", "tools", "appearance", "general", "keyboard", "account"]) {
      await visit(page, `/settings/${section}`)
      await page.locator(`[data-component="settings"] [data-section="${section}"][aria-current="page"]`).waitFor()
      await healthy(page, `cold settings ${section}`)
    }
    for (const path of ["/files", "/memory"]) {
      await visit(page, path)
      await page.locator('[data-component="sidecar"]').waitFor()
      await healthy(page, path)
    }
    await surfaces(page)
    await page.goto(`${origin}/recipes`)
    await page.getByRole("searchbox", { name: "Search recipes" }).waitFor()
    await healthy(page, "recipes")
    await visit(page, "/")
    const pinned = page.locator('[data-component="sidebar-row"][data-main]')
    await pinned.click({ button: "right" })
    await page.getByRole("menuitem", { name: "Mark as unread", exact: true }).click()
    await page.locator('[data-component="sidebar-row"][data-main][data-unread]').waitFor()
    assert.equal(await pinned.locator('[data-component="sidebar-unread-count"]').count(), 0, "Marking unread must not invent a message count")
    assert.equal(await page.locator('[data-component="sidebar-pin-dot"], [data-component="sidebar-unread-dot"]').count(), 0)
    await healthy(page, "marked unread row")
  } finally {
    await context.close()
  }
}

async function verifyColdStarts(browser: Browser): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const context = await signedIn(browser, i % 2 === 1)
    try {
      const page = await context.newPage()
      observe(page)
      await visit(page, ["/", "/memory", "/files"][i % 3] ?? "/")
      await page.waitForTimeout(500)
      await healthy(page, `${i % 2 ? "mobile" : "desktop"} cold start ${i + 1}`)
      for (let refresh = 0; refresh < 3; refresh++) {
        await page.reload()
        await page.locator('[data-component="prompt-input"]').waitFor()
        await healthy(page, `warm reload ${refresh + 1}`)
      }
    } finally {
      await context.close()
    }
  }
}

const browser = await chromium.launch({ executablePath: process.env.KIKO_BROWSER_EXECUTABLE })
try {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    observe(page)
    await page.goto(origin)
    await page.getByRole("heading", { name: "Welcome to Kiko" }).waitFor()
    await healthy(page, "signed-out startup")
  } finally {
    await context.close()
  }
  await verifyDesktop(browser)
  await verifyColdStarts(browser)
  assert.deepEqual([...failures], [])
  console.log("pass browser runtime verification with zero errors")
} catch (error) {
  console.error("Captured runtime errors", [...failures])
  throw error
} finally {
  await browser.close()
}
