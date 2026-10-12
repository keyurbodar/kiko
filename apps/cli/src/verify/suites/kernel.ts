import { activeBrowsers as active, kernel, kernelKey, waitForNoBrowsers } from "../browser-kit"
import { expectEqual, VerifyError } from "../client"
import { api } from "../routine-kit"
import type { Suite } from "../runner"


const USER = "kernel-alice"
const BAD_KEY = "sk_not_a_real_key_0000"
const CONFIRM = "delete my account"
const COOKIE = "yuki_probe"
const IDLE_PAST_MS = 6 * 60_000

type Status = { connected: boolean; broken: boolean; browser: { mode: string; tabs: Record<string, number> } | null }
type Result = { ok: true; status: Status } | { ok: false; error: string }
type Lease = { sessionId: string; mode: string; restarted?: boolean; reopen?: string[] }

const suite: Suite = {
  name: "kernel",
  human: true,
  async run(v) {
    const key = kernelKey()
    await waitForNoBrowsers()

    const s = await v.as(USER)
    const user = await s.user()
    let n = 0
    const ask = async (frame: Record<string, unknown>): Promise<Result> => {
      const reqId = `k${++n}`
      user.send({ ...frame, reqId } as never)
      const answer = await user.expect((f) => (f as { t: string; reqId?: string }).t === "kernel" && (f as { reqId?: string }).reqId === reqId, 60_000)
      return (answer as unknown as { result: Result }).result
    }
    const dev = async <T>(body: Record<string, unknown>): Promise<{ status: number; json: T }> => api<T>(v.url, s, "dev/agent/browser", body)
    const seen = new Set<string>()
    const lease = async (agentId: string): Promise<Lease> => {
      const out = await dev<Lease>({ action: "lease", agentId })
      if (out.status !== 200) throw new VerifyError(`lease for ${agentId} answered ${out.status}: ${JSON.stringify(out.json)}`)
      seen.add(out.json.sessionId)
      return out.json
    }
    const expectOnly = async (current: string, what: string) => {
      seen.add(current)
      expectEqual((await active()).filter((id) => seen.has(id)), [current], `Kernel's active browsers of this run ${what}`)
    }
    const ours = async () => (await active()).filter((id) => seen.has(id))
    const hasCookie = async (sessionId: string): Promise<boolean> => {
      const out = await kernel<{ success: boolean; result?: { name: string }[]; error?: string }>("POST", `/browsers/${sessionId}/playwright/execute`, {
        code: "return await context.cookies('https://example.com')",
        timeout_sec: 30,
      })
      if (out.status !== 200 || !out.json.success) throw new VerifyError(`reading cookies answered ${out.status}: ${JSON.stringify(out.json).slice(0, 300)}`)
      return (out.json.result ?? []).some((c) => c.name === COOKIE)
    }
    const timed = async <T>(label: string, run: () => Promise<T>): Promise<T> => {
      const t = performance.now()
      try {
        return await run()
      } finally {
        console.error(`  ${label}: ${((performance.now() - t) / 1000).toFixed(1)} s`)
      }
    }

    let profile = ""
    try {
      await ask({ t: "disconnectKernel" })
      const bad = await ask({ t: "connectKernel", apiKey: BAD_KEY })
      if (bad.ok) throw new VerifyError("a bad kernel key was accepted")
      console.error(`bad key refused: ${bad.error}`)
      const after = await ask({ t: "kernelStatus" })
      if (!after.ok) throw new VerifyError(`status after a bad key failed: ${after.error}`)
      expectEqual(after.status, { connected: false, broken: false, browser: null }, "status after a bad key")
      const noKey = await dev<{ error: string }>({ action: "lease", agentId: "room-a/ada" })
      expectEqual(noKey.status, 409, "a lease with no key stored")

      const good = await ask({ t: "connectKernel", apiKey: key })
      if (!good.ok) throw new VerifyError(`connect failed: ${good.error}`)
      expectEqual(good.status, { connected: true, broken: false, browser: null }, "status after connect")

      const [first, second] = await timed("two concurrent leases", () => Promise.all([lease("room-a/ada"), lease("room-b/bob")]))
      expectEqual(first?.sessionId, second?.sessionId, "the session two agents got")
      expectEqual([first?.mode, second?.mode, first?.restarted, second?.restarted], ["headless", "headless", false, false], "mode and restarted")
      await expectOnly(first?.sessionId, "after two leases")
      const state = await dev<{ profile: string }>({ action: "state" })
      profile = state.json.profile
      const listed = await ask({ t: "kernelStatus" })
      if (!listed.ok) throw new VerifyError(`status failed: ${listed.error}`)
      expectEqual(listed.status.browser?.mode, "headless", "browser mode in the status")
      expectEqual(Object.keys(listed.status.browser?.tabs ?? {}).sort(), ["room-a/ada", "room-b/bob"], "agents in the status")

      const set = await kernel<{ success: boolean; error?: string }>("POST", `/browsers/${first?.sessionId}/playwright/execute`, {
        code: `await context.addCookies([{ name: '${COOKIE}', value: '1', domain: 'example.com', path: '/', expires: Math.floor(Date.now() / 1000) + 86400 }]); return true`,
        timeout_sec: 30,
      })
      if (set.status !== 200 || !set.json.success) throw new VerifyError(`setting the cookie answered ${set.status}: ${JSON.stringify(set.json).slice(0, 300)}`)
      if (!(await hasCookie(first?.sessionId))) throw new VerifyError("the cookie was not set")

      await dev({ action: "age", ms: IDLE_PAST_MS })
      await timed("reap", () => dev({ action: "reap" }))
      expectEqual(await ours(), [], "Kernel's active browsers of this run after the reaper")
      expectEqual((await dev<{ sessionId: string | null }>({ action: "state" })).json.sessionId, null, "the lease after the reaper")
      const afterReap = await timed("lease after the reaper", () => lease("room-a/ada"))
      if (afterReap.sessionId === first?.sessionId) throw new VerifyError("the reaped browser was handed out again")
      if (!(await hasCookie(afterReap.sessionId))) throw new VerifyError("the cookie did not survive the reaper")
      console.error("  cookie survived the reaper")

      const headful = await timed("switch to headful", () => dev<Lease>({ action: "switch", mode: "headful" }))
      expectEqual([headful.status, headful.json.mode], [200, "headful"], "the switch answer")
      if (headful.json.sessionId === afterReap.sessionId) throw new VerifyError("a switch kept the old browser")
      await expectOnly(headful.json.sessionId, "after the switch")
      if (!(await hasCookie(headful.json.sessionId))) throw new VerifyError("the cookie did not survive the switch to headful")
      const sameHeadful = await lease("room-b/bob")
      expectEqual([sameHeadful.sessionId, sameHeadful.mode], [headful.json.sessionId, "headful"], "a lease while headful")
      const back = await timed("switch to headless", () => dev<Lease>({ action: "switch", mode: "headless" }))
      expectEqual([back.status, back.json.mode], [200, "headless"], "the switch back")
      await expectOnly(back.json.sessionId, "after the switch back")
      if (!(await hasCookie(back.json.sessionId))) throw new VerifyError("the cookie did not survive the switch back")
      console.error("  cookie survived headful and back")

      await dev({ action: "dead", agentId: "room-a/ada" })
      const replaced = await timed("lease after a dead socket", () => lease("room-a/ada"))
      if (replaced.sessionId === back.json.sessionId) throw new VerifyError("a dead browser was handed out again")
      expectEqual(replaced.restarted, true, "restarted after a dead socket")
      await expectOnly(replaced.sessionId, "after the replacement")
      if (!(await hasCookie(replaced.sessionId))) throw new VerifyError("the cookie did not survive the replacement")

      const leaks = user.texts.filter((t) => t.includes(key) || /wss?:\/\/|onkernel\.com|cdp|live_view/i.test(t))
      if (leaks.length) throw new VerifyError(`${leaks.length} frame(s) hold a key or a browser URL, for example: ${leaks[0]?.replace(key, "<key>").slice(0, 200)}`)
      console.error(`  ${user.texts.length} frames scanned, none holds the key or a browser URL`)

      const profiles = async () => (await kernel<{ name?: string }[]>("GET", "/profiles")).json.map((p) => p.name)
      if (!(await profiles()).includes(profile)) throw new VerifyError("the profile does not exist on Kernel")
      const deleted = await fetch(new URL("api/account/delete", v.url), {
        method: "POST",
        headers: { cookie: s.cookie, "content-type": "application/json" },
        body: JSON.stringify({ confirm: CONFIRM }),
      })
      expectEqual(deleted.status, 202, "the delete answer")
      const deadline = Date.now() + 60_000
      while ((await ours()).length || (await profiles()).includes(profile)) {
        if (Date.now() > deadline) throw new VerifyError("account deletion left a browser or the profile on Kernel")
        await Bun.sleep(1_000)
      }
      console.error("  account deletion removed the browser and the profile")
    } finally {
      for (const id of await ours().catch(() => [])) await kernel("DELETE", `/browsers/${id}`).catch(() => undefined)
      if (profile) await kernel("DELETE", `/profiles/${profile}`).catch(() => undefined)
    }
    expectEqual(await ours(), [], "this run's browsers still active at the end")
    // Browsers of other runs on the same key time out on their own.
    for (const start = Date.now(); (await active()).length; await Bun.sleep(5_000)) {
      if (Date.now() - start > 150_000) throw new VerifyError(`Kernel still has ${(await active()).length} active browser(s) at the end, none of them from this run`)
    }
    expectEqual(await active(), [], "Kernel's active browsers at the end")
  },
}

export default suite
