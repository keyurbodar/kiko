import { BROWSER } from "../config"
import { act, schemeError, screenshot } from "../page/act"
import { evaluate, type PageState, read } from "../page/read"
import type { BrowserSession, Tab } from "../page/types"
import { openSession, type SessionOptions } from "./session"

export type ConnectOptions = SessionOptions & { now?: () => number }

export async function connect(cdpUrl: string, options: ConnectOptions = {}): Promise<BrowserSession> {
  const cdp = await openSession(cdpUrl, options)
  const tabs = new Map<string, Tab>()
  const opening = new Set<string>()

  const releases = new Map<string, () => void>()

  const adopt = async (targetId: string, url?: string): Promise<Tab> => {
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true })
    const page: PageState = { channel: cdp.channel(sessionId), targetId, labels: new Map(), notes: [] }
    const subscriptions = [
      page.channel.on("Page.javascriptDialogOpening", (dialog) => {
        page.channel.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {})
        if (dialog.type === "confirm" || dialog.type === "prompt")
          page.notes.push(`${dialog.type} said "${dialog.message}": accepted`)
      }),
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
      const loaded = url ? page.channel.waitFor("Page.loadEventFired", BROWSER.loadMs) : undefined
      const [, , ready] = await Promise.all([
        page.channel.send("Page.enable"),
        page.channel.send("Emulation.setFocusEmulationEnabled", { enabled: true }),
        url
          ? evaluate<boolean>(page, `location.href !== "about:blank" && document.readyState === "complete"`).catch(
              () => false,
            )
          : true,
      ])
      if (!ready) await loaded
    } catch (error) {
      release()
      throw error
    }
    const tab: Tab = {
      id: targetId,
      read: () => read(page),
      act: (step) => act(page, step),
      screenshot: (opts) => screenshot(page, opts),
      takeNotes: () => page.notes.splice(0, page.notes.length),
      front: async () => {
        await page.channel.send("Page.bringToFront")
      },
      close: async () => {
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

  return {
    openTab: async (url) => {
      const invalid = url === undefined ? undefined : schemeError(url)
      if (invalid) throw new Error(invalid)
      const { targetId } = await cdp.send("Target.createTarget", {
        url: url ?? "about:blank",
        background: true,
        newWindow: true,
      })
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
      return targetInfos
        .filter((t) => tabs.has(t.targetId))
        .map((t) => ({ id: t.targetId, url: t.url, title: t.title }))
    },
    closed: cdp.closed,
    close: () => cdp.close(),
  }
}
