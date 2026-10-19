import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(import.meta.dir, "chunk-recovery.ts"), "utf8")
const js = new Bun.Transpiler({ loader: "ts" }).transformSync(source).replaceAll("export ", "")

function boot(storage: Map<string, string>, blocked = false) {
  let reloads = 0
  const requested: string[] = []
  const alert = { style: { display: "none" } }
  const recovery = new Function("sessionStorage", "document", "location", "fetch", `${js}; return { recover, clearRecovery, recoveryPending }`)(
    { getItem: (key: string) => { if (blocked) throw new Error("Blocked"); return storage.get(key) ?? null }, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    { getElementById: () => alert },
    { reload: () => { reloads++ } },
    (file: string) => { requested.push(file); return Promise.resolve(new Response()) },
  )
  return { recovery, alert, requested, reloads: () => reloads }
}

test("chunk recovery reloads once across boots, coalesces failures and shows an alert on retry", async () => {
  const storage = new Map<string, string>()
  const first = boot(storage)
  await Promise.all([first.recovery.recover("/assets/main-old.js"), first.recovery.recover("/assets/route-old.js")])
  expect(first.reloads()).toBe(1)
  expect(first.requested).toEqual(["/assets/main-old.js"])
  const second = boot(storage)
  await second.recovery.recover("/assets/main-old.js")
  expect(second.reloads()).toBe(0)
  expect(second.alert.style.display).toBe("block")
  second.recovery.clearRecovery()
  const later = boot(storage)
  await later.recovery.recover("/assets/later.js")
  expect(later.reloads()).toBe(1)
})

test("blocked storage shows an error without a reload loop", async () => {
  const app = boot(new Map(), true)
  await app.recovery.recover("failed")
  expect(app.reloads()).toBe(0)
  expect(app.alert.style.display).toBe("block")
})

test("startup keeps a bounded external splash until initial UI chunks resolve, with no saved DOM replay", () => {
  const web = join(import.meta.dir, "../..")
  const html = readFileSync(join(web, "index.html"), "utf8")
  const main = readFileSync(join(web, "src/main.tsx"), "utf8")
  const bootstrap = readFileSync(join(web, "src/bootstrap.ts"), "utf8")
  expect(html).toContain('src="/kiko.svg" width="64" height="64"')
  expect(html).toContain("max-width: 64px; max-height: 64px; object-fit: contain")
  for (const old of ['id="snap"', "innerHTML", "data-snap", "@keyframes", "<svg"]) expect(html).not.toContain(old)
  expect(main.indexOf("await FirstRun.preload()")).toBeLessThan(main.indexOf("render(()"))
  expect(main.indexOf("await FirstRun.preload()")).toBeLessThan(main.indexOf("root.replaceChildren()"))
  expect(main).not.toContain("startSnapshots")
  expect(bootstrap).toContain('import("./app/first-run/frame")')
})
