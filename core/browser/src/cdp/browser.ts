import { BROWSER } from "../config"
import { act, schemeError, screenshot } from "../page/act"
import { extract, evaluateExpression } from "../page/extract"
import { evaluate, type PageState, read } from "../page/read"
import type { BrowserSession, Dialog, DialogPolicy, Tab } from "../page/types"
import { openSession, type SessionOptions } from "./session"

export type ConnectOptions = SessionOptions & { now?: () => number }

const policy: DialogPolicy = (dialog) => (dialog.type === "alert" || dialog.type === "beforeunload" ? "accept" : "stop")

export async function connect(cdpUrl: string, options: ConnectOptions = {}): Promise<BrowserSession> {
  const cdp = await openSession(cdpUrl, options)
  const now = options.now ?? Date.now
  const tabs = new Map<string, Tab>()
  const opening = new Set<string>()

  const releases = new Map<string, () => void>()

  const adopt = async (targetId: string, url?: string): Promise<Tab> => {
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true })
    const page: PageState = { channel: cdp.channel(sessionId), targetId, labels: new Map() }
    let heldAt = 0
    // Nobody answered in time: the next call dismisses it, so a stray confirm or prompt cannot wedge the agent.
    // A timer would run inside a Durable Object between calls, which AGENTS.md forbids.
    const settle = () => {
      if (!page.dialog || now() - heldAt < BROWSER.dialogHoldMs) return
      page.dialog = undefined
      page.channel.send("Page.handleJavaScriptDialog", { accept: false }).catch(() => {})
    }
    const subscriptions = [
      page.channel.on("Page.javascriptDialogOpening", (dialog) => {
        const shown: Dialog = { type: dialog.type, message: dialog.message }
        if (policy(shown) === "accept") {
          page.channel.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {})
          return
        }
        page.dialog = shown
        heldAt = now()
      }),
      page.channel.on("Page.javascriptDialogClosed", () => {
        page.dialog = undefined
      }),
      // The load waiter is registered from the start event, so it exists before the load can fire.
      page.channel.on("Page.frameStartedLoading", (event) => {
        if (event.frameId !== targetId) return
        const loading: Promise<unknown> = page.channel
          .waitFor("Page.loadEventFired", BROWSER.loadMs)
          .catch(() => undefined)
          .then(() => {
            if (page.loading === loading) page.loading = undefined
          })
        page.loading = loading
      }),
      page.channel.on("Inspector.targetCrashed", () => {
        page.crashed = true
      }),
    ]
    const release = () => {
      for (const off of subscriptions) off()
    }
    try {
      // A tab created at its url loads while we attach, so wait for its load unless it already finished.
      const loaded = url ? page.channel.waitFor("Page.loadEventFired", BROWSER.loadMs) : undefined
      const [, , ready] = await Promise.all([
        page.channel.send("Page.enable"),
        page.channel.send("Emulation.setFocusEmulationEnabled", { enabled: true }),
        url ? evaluate<boolean>(page, `location.href !== "about:blank" && document.readyState === "complete"`).catch(() => false) : true,
      ])
      if (!ready) await loaded
    } catch (error) {
      release()
      throw error
    }
    const info = async () => (await cdp.send("Target.getTargetInfo", { targetId })).targetInfo
    const tab: Tab = {
      id: targetId,
      read: () => {
        settle()
        return read(page)
      },
      act: (step) => {
        settle()
        return act(page, step)
      },
      eval: (expression) => {
        settle()
        return evaluateExpression(page, expression)
      },
      extract: (kind) => {
        settle()
        return extract(page, kind)
      },
      screenshot: (opts) => {
        settle()
        return screenshot(page, opts)
      },
      dialog: () => {
        settle()
        return page.dialog ?? null
      },
      answerDialog: async (accept, text) => {
        settle()
        if (!page.dialog) return false
        page.dialog = undefined
        return page.channel
          .send("Page.handleJavaScriptDialog", { accept, promptText: text })
          .then(() => true)
          .catch(() => false)
      },
      url: async () => (await info()).url,
      title: async () => (await info()).title,
      front: async () => {
        await page.channel.send("Page.bringToFront")
      },
      close: async () => {
        page.dialog = undefined
        tabs.delete(targetId)
        await cdp.send("Target.closeTarget", { targetId }).catch(() => {})
      },
    }
    tabs.set(targetId, tab)
    releases.set(targetId, release)
    return tab
  }

  cdp.on("Target.targetCreated", ({ targetInfo }) => {
    const opener = targetInfo.openerId
    if (targetInfo.type !== "page" || !opener || !tabs.has(opener)) return
    if (tabs.has(targetInfo.targetId) || opening.has(targetInfo.targetId)) return
    opening.add(targetInfo.targetId)
    adopt(targetInfo.targetId)
      .catch(() => {})
      .finally(() => opening.delete(targetInfo.targetId))
  })
  cdp.on("Target.targetDestroyed", ({ targetId }) => {
    tabs.delete(targetId)
    releases.get(targetId)?.()
    releases.delete(targetId)
  })
  await cdp.send("Target.setDiscoverTargets", { discover: true })
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: BROWSER.downloadDir }).catch(() => {})

  return {
    openTab: async (url) => {
      const invalid = url === undefined ? undefined : schemeError(url)
      if (invalid) throw new Error(invalid)
      // Background tabs in a shared window get ~0 animation frames on Kernel; their own unactivated window keeps rendering.
      const { targetId } = await cdp.send("Target.createTarget", { url: url ?? "about:blank", background: true, newWindow: true })
      return adopt(targetId, url)
    },
    tab: (id) => tabs.get(id),
    attach: async (id) => {
      const known = tabs.get(id)
      if (known) return known
      const { targetInfos } = await cdp.send("Target.getTargets")
      if (!targetInfos.some((t) => t.targetId === id && t.type === "page")) return undefined
      return adopt(id)
    },
    listTabs: async () => {
      const { targetInfos } = await cdp.send("Target.getTargets")
      return targetInfos.filter((t) => tabs.has(t.targetId)).map((t) => ({ id: t.targetId, url: t.url, title: t.title }))
    },
    closed: cdp.closed,
    close: () => cdp.close(),
  }
}
