import type { BrowserState, UserToClient } from "@yuki/protocol"
import { expectEqual, VerifyError } from "../client"
import { api } from "../routine-kit"
import type { Suite } from "../runner"

// P17-05, architecture section 27.7. Watch and take over, on a real Kernel key. Needs
// KERNEL_API_KEY in the shell. No model is called.
//
// An agent holds a tab in a headless browser. `browserLink { mode: "watch" }` switches it to
// headful (Kernel says `headless: false`), pushes the switching state, and answers with a live
// view URL that carries `readOnly=true`. `browserLink { mode: "control" }` sets the takeover flag,
// and `handBack` clears it. A cookie set before the switch is in the new browser. `closeBrowser`
// ends the browser. No frame but the `browserLink` answers holds a URL, and Kernel's active list
// is empty at the end.

const KERNEL = "https://api.onkernel.com"
const USER = "takeover-alice"
const COOKIE = "yuki_probe"
const AGENT = "room-a/ada"

type State = Extract<BrowserState, object>
type Link = Extract<UserToClient, { t: "browserLink" }>

const suite: Suite = {
  name: "browser-takeover",
  human: true,
  async run(v) {
    const key = process.env.KERNEL_API_KEY
    if (!key) throw new VerifyError("KERNEL_API_KEY is not set in this shell")
    const kernel = async <T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> => {
      const res = await fetch(`${KERNEL}${path}`, {
        method,
        headers: { authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
      })
      const text = await res.text()
      return { status: res.status, json: (text ? JSON.parse(text) : null) as T }
    }
    const active = async () => {
      const out = await kernel<{ session_id: string }[]>("GET", "/browsers?status=active")
      if (out.status !== 200) throw new VerifyError(`Kernel answered ${out.status} to the active list`)
      return out.json.map((b) => b.session_id)
    }
    for (const start = Date.now(); (await active()).length; await Bun.sleep(5_000)) {
      if (Date.now() - start > 150_000) throw new VerifyError("Kernel still has active browsers on this key after 150 s. Close them first")
    }

    const s = await v.as(USER)
    const user = await s.user()
    let n = 0
    const ask = async (frame: Record<string, unknown>) => {
      const reqId = `k${++n}`
      user.send({ ...frame, reqId } as never)
      const answer = await user.expect((f) => (f as { t: string; reqId?: string }).t === "kernel" && (f as { reqId?: string }).reqId === reqId, 60_000)
      return (answer as unknown as { result: { ok: boolean; error?: string } }).result
    }
    const dev = async <T>(path: string, body: Record<string, unknown>) => api<T>(v.url, s, path, body)
    const state = async (match: (b: State) => boolean, what: string): Promise<State> => {
      const frame = await user.expect((f) => f.t === "browserState" && f.state !== null && match(f.state), 60_000).catch(() => {
        throw new VerifyError(`no browserState for: ${what}`)
      })
      return (frame as Extract<UserToClient, { t: "browserState" }>).state as State
    }
    const link = async (mode: "watch" | "control"): Promise<Link> => {
      const reqId = `l${++n}`
      user.send({ t: "browserLink", reqId, mode })
      return (await user.expect((f) => f.t === "browserLink" && f.reqId === reqId, 90_000)) as Link
    }
    const sessionId = async () => (await dev<{ sessionId: string | null }>("dev/agent/browser", { action: "state" })).json.sessionId
    const headless = async (id: string) => (await kernel<{ headless: boolean }>("GET", `/browsers/${id}`)).json.headless
    const hasCookie = async (id: string): Promise<boolean> => {
      const out = await kernel<{ success: boolean; result?: { name: string }[] }>("POST", `/browsers/${id}/playwright/execute`, {
        code: "return await context.cookies('https://example.com')",
        timeout_sec: 30,
      })
      if (out.status !== 200 || !out.json.success) throw new VerifyError(`reading cookies answered ${out.status}`)
      return (out.json.result ?? []).some((c) => c.name === COOKIE)
    }
    const seen = new Set<string>()
    let profile = ""
    try {
      await ask({ t: "disconnectKernel" })
      const good = await ask({ t: "connectKernel", apiKey: key })
      if (!good.ok) throw new VerifyError(`connect failed: ${good.error}`)

      // No browser: a link is refused, and there is nothing to show.
      const none = await link("watch")
      expectEqual(none.result.ok, false, "a link with no browser open")

      const lease = await dev<{ sessionId: string; mode: string }>("dev/agent/browser", { action: "lease", agentId: AGENT })
      if (lease.status !== 200) throw new VerifyError(`lease answered ${lease.status}`)
      seen.add(lease.json.sessionId)
      profile = (await dev<{ profile: string }>("dev/agent/browser", { action: "state" })).json.profile
      expectEqual(await headless(lease.json.sessionId), true, "the first browser is headless")
      await dev("dev/user/browser-tabs", { agentId: AGENT, tabs: { t1: "https://example.com/login?token=secret" } })
      const idle = await state((b) => b.tabs.length === 1, "an agent's tab")
      expectEqual([idle.mode, idle.takeover, idle.switching, idle.tabs[0]?.slug, idle.tabs[0]?.host], ["headless", false, false, "ada", "example.com"], "the state with a tab")

      const set = await kernel<{ success: boolean }>("POST", `/browsers/${lease.json.sessionId}/playwright/execute`, {
        code: `await context.addCookies([{ name: '${COOKIE}', value: '1', domain: 'example.com', path: '/', expires: Math.floor(Date.now() / 1000) + 86400 }]); return true`,
        timeout_sec: 30,
      })
      if (set.status !== 200 || !set.json.success) throw new VerifyError(`setting the cookie answered ${set.status}`)

      // Watch: switching is pushed, then the headful state, then the read-only link.
      const started = performance.now()
      user.send({ t: "browserLink", reqId: "watch1", mode: "watch" })
      await state((b) => b.switching, "the switching state")
      const headful = await state((b) => b.mode === "headful" && !b.switching, "headful and done switching")
      const watch = (await user.expect((f) => f.t === "browserLink" && f.reqId === "watch1", 90_000)) as Link
      console.error(`  watch link: ${((performance.now() - started) / 1000).toFixed(1)} s`)
      if (!watch.result.ok) throw new VerifyError(`watch failed: ${watch.result.error}`)
      expectEqual(new URL(watch.result.url).searchParams.get("readOnly"), "true", "readOnly on the watch link")
      expectEqual([headful.takeover, headful.tabs[0]?.host], [false, "example.com"], "the state after the switch")
      const watching = await sessionId()
      if (!watching || watching === lease.json.sessionId) throw new VerifyError("the switch kept the old browser")
      seen.add(watching)
      expectEqual(await headless(watching), false, "Kernel says the watched browser is headful")
      if (!(await hasCookie(watching))) throw new VerifyError("the cookie did not survive the switch to headful")

      // Take over sets the flag, and the link has no readOnly.
      const control = await link("control")
      if (!control.result.ok) throw new VerifyError(`control failed: ${control.result.error}`)
      expectEqual(new URL(control.result.url).searchParams.has("readOnly"), false, "no readOnly on the control link")
      await state((b) => b.takeover, "the takeover flag")
      expectEqual((await sessionId()) === watching, true, "control on a headful browser keeps it")

      user.send({ t: "handBack" })
      await state((b) => !b.takeover, "hand back")

      // Close ends the browser and the state goes to null.
      user.send({ t: "closeBrowser" })
      await user.expect((f) => f.t === "browserState" && f.state === null, 60_000)
      expectEqual(await sessionId(), null, "the lease after close")
      expectEqual((await active()).filter((id) => seen.has(id)), [], "Kernel's active browsers of this run after close")

      // Nothing but the two link answers holds a URL, a key, or a page address.
      const leaks = user.texts.filter((t) => !t.includes('"t":"browserLink"') && (t.includes(key) || /https?:|wss?:|onkernel\.com|cdp|live_view|secret/i.test(t)))
      if (leaks.length) throw new VerifyError(`${leaks.length} frame(s) hold a URL or a key, for example: ${leaks[0]!.replace(key, "<key>").slice(0, 200)}`)
      console.error(`  ${user.texts.length} frames scanned, only the browserLink answers hold a URL`)
    } finally {
      await ask({ t: "disconnectKernel" }).catch(() => undefined)
      for (const id of await active().catch(() => [] as string[])) if (seen.has(id)) await kernel("DELETE", `/browsers/${id}`).catch(() => undefined)
      if (profile) await kernel("DELETE", `/profiles/${profile}`).catch(() => undefined)
    }
    for (const start = Date.now(); (await active()).length; await Bun.sleep(5_000)) {
      if (Date.now() - start > 150_000) throw new VerifyError(`Kernel still has ${(await active()).length} active browser(s) at the end`)
    }
    expectEqual(await active(), [], "Kernel's active browsers at the end")
  },
}

export default suite
