import { describe, expect, it } from "vitest"
import { onAuthChange, prepareStorage, purge, setSigningOut } from "./storage"

const open = (name: string) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.addEventListener("upgradeneeded", () => request.result.createObjectStore("rows"))
    request.addEventListener("success", () => resolve(request.result))
    request.addEventListener("error", () => reject(request.error))
  })

const names = async () => (await indexedDB.databases()).map((database) => database.name).sort()

const keys = (storage: Storage) =>
  Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => key !== null)
    .sort()

function seed(): void {
  localStorage.clear()
  sessionStorage.clear()
  for (const key of [
    "kiko:auth",
    "kiko:profile",
    "kiko:drafts:owner",
    "kiko:look",
    "kiko.model-prefs",
    "kiko.last-chat:owner",
    "kiko:device:sidebar-width",
    "kiko:device:keybindings",
    "other-app",
  ])
    localStorage.setItem(key, "1")
  sessionStorage.setItem("kiko:connect", "{}")
  sessionStorage.setItem("other-app", "1")
}

describe("purging local data", () => {
  it("leaves only device preferences and other sites' keys", async () => {
    seed()
    setSigningOut(true)
    for (const database of await Promise.all(["kiko:client-runtime", "kiko-composer", "kiko:warm:owner"].map(open)))
      database.close()
    const other = await open("other-app")
    other.close()

    await purge()

    expect(keys(localStorage)).toEqual([
      "kiko:device:keybindings",
      "kiko:device:sidebar-width",
      "kiko:signing-out",
      "other-app",
    ])
    expect(keys(sessionStorage)).toEqual(["other-app"])
    expect(await names()).toEqual(["other-app"])
    setSigningOut(false)
    expect(localStorage.getItem("kiko:signing-out")).toBeNull()
  })

  it("waits for another tab to let go of a database instead of failing", async () => {
    seed()
    const held = await open("kiko-composer")
    const asked = new Promise<void>((resolve) => held.addEventListener("versionchange", () => resolve()))
    let finished = false
    const purged = purge().then(() => {
      finished = true
    })

    await asked
    expect(finished).toBe(false)
    held.close()
    await purged
    expect(await names()).not.toContain("kiko-composer")
  })
})

describe("the storage schema marker", () => {
  it("purges everything once when the marker is missing, then keeps new data", async () => {
    seed()
    localStorage.removeItem("kiko:schema")
    const runtime = await open("kiko:client-runtime")
    runtime.close()

    prepareStorage()

    expect(keys(localStorage)).toEqual([
      "kiko:device:keybindings",
      "kiko:device:sidebar-width",
      "kiko:schema",
      "other-app",
    ])
    localStorage.setItem("kiko:auth", "1")
    prepareStorage()
    expect(localStorage.getItem("kiko:auth")).toBe("1")
    await expect.poll(names).not.toContain("kiko:client-runtime")
  })
})

describe("another tab", () => {
  it("reports each change to kiko:auth there, and nothing else", async () => {
    localStorage.clear()
    const frame = document.createElement("iframe")
    document.body.append(frame)
    const seen: (string | null)[] = []
    const stop = onAuthChange((raw) => seen.push(raw))
    try {
      const other = frame.contentWindow!.localStorage
      other.setItem("kiko:auth", "signed in")
      await expect.poll(() => seen).toEqual(["signed in"])
      other.setItem("kiko:device:sidebar-width", "300")
      other.removeItem("kiko:auth")
      await expect.poll(() => seen).toEqual(["signed in", null])
    } finally {
      stop()
      frame.remove()
    }
  })
})
