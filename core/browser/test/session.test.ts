import { afterEach, expect, test } from "bun:test"
import { CdpError, openSession } from "../src/cdp/session"
import { type FakeCdp, fakeCdp } from "./fake-cdp"

let fake: FakeCdp | undefined
afterEach(() => fake?.stop())

test("a pending command fails when the socket closes, and closed resolves", async () => {
  fake = fakeCdp({
    "Browser.getVersion": (_message, ws) => {
      ws.close()
      return undefined
    },
  })
  const cdp = await openSession(fake.url)
  const error = await cdp.send("Browser.getVersion").catch((e: unknown) => e)
  expect(error).toBeInstanceOf(CdpError)
  expect((error as CdpError).kind).toBe("closed")
  await cdp.closed
  const after = await cdp.send("Browser.getVersion").catch((e: unknown) => e)
  expect((after as CdpError).kind).toBe("closed")
})

test("a silent command times out, and the session keeps working", async () => {
  fake = fakeCdp({ "Browser.getVersion": () => undefined, "Target.getTargets": () => ({ targetInfos: [] }) })
  const cdp = await openSession(fake.url, { commandMs: 80 })
  const start = performance.now()
  const error = await cdp.send("Browser.getVersion").catch((e: unknown) => e)
  expect((error as CdpError).kind).toBe("timeout")
  expect(performance.now() - start).toBeLessThan(1_000)
  expect(await cdp.send("Target.getTargets")).toEqual({ targetInfos: [] })
  await cdp.close()
})

test("a waiter registered before the command catches an event sent before its answer", async () => {
  fake = fakeCdp({
    "Page.navigate": (message, _ws, f) => {
      f.emit("Page.loadEventFired", { timestamp: 7 }, message.sessionId)
      return { frameId: "F" }
    },
  })
  const cdp = await openSession(fake.url)
  const tab = cdp.channel("S1")
  const other = cdp.channel("S2").waitFor("Page.loadEventFired", 150)
  const loaded = tab.waitFor("Page.loadEventFired", 2_000)
  await tab.send("Page.navigate", { url: "https://example.com" })
  expect(await loaded).toEqual({ timestamp: 7 })
  // An event for one flat session does not wake a waiter on another.
  expect(await other).toBeUndefined()
  await cdp.close()
})

test("a waiter fails when the socket closes instead of hanging", async () => {
  fake = fakeCdp()
  const cdp = await openSession(fake.url)
  const loaded = cdp.channel("S1").waitFor("Page.loadEventFired", 5_000)
  await cdp.close()
  expect(((await loaded.catch((e: unknown) => e)) as CdpError).kind).toBe("closed")
})
