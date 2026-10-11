import { BROWSER } from "../config"
import { act, schemeError, screenshot } from "../page/act"
import { extract, evaluateExpression } from "../page/extract"
import { evaluate, type PageState, read } from "../page/read"
import type { BrowserSession, Dialog, DialogPolicy, Tab } from "../page/types"
import { openSession, type SessionOptions } from "./session"

export type ConnectOptions = SessionOptions & { dialogs?: DialogPolicy }

const defaultPolicy: DialogPolicy = (dialog) => (dialog.type === "alert" || dialog.type === "beforeunload" ? "accept" : "stop")

export async function connect(cdpUrl: string, options: ConnectOptions = {}): Promise<BrowserSession> {
  const cdp = await openSession(cdpUrl, options)
  const policy = options.dialogs ?? defaultPolicy
  const tabs = new Map<string, Tab>()
  const opening = new Set<string>()
  const popupListeners = new Set<(opener: string, tab: Tab) => void>()

  const adopt = async (targetId: string, url?: string): Promise<Tab> => {
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true })
    const page: PageState = { channel: cdp.channel(sessionId), targetId, labels: new Map() }
    page.channel.on("Page.javascriptDialogOpening", (dialog) => {
      const shown: Dialog = { type: dialog.type, message: dialog.message }
      if (policy(shown) === "accept") {
        page.channel.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {})
        return
      }
      page.dialog = shown
      // Nobody answered in time: dismiss it so a stray confirm or prompt cannot wedge the agent.
      setTimeout(() => {
        if (page.dialog !== shown) return
        page.dialog = undefined
        page.channel.send("Page.handleJavaScriptDialog", { accept: false }).catch(() => {})
      }, BROWSER.dialogHoldMs)
    })
    page.channel.on("Page.javascriptDialogClosed", () => {
      page.dialog = undefined
    })
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
    })
    page.channel.on("Inspector.targetCrashed", () => {
      page.crashed = true
    })
    // A tab created at its url loads while we attach. Wait for load unless it already finished.
    const loaded = url ? page.channel.waitFor("Page.loadEventFired", BROWSER.loadMs) : undefined
    const [, , ready] = await Promise.all([
      page.channel.send("Page.enable"),
      page.channel.send("Emulation.setFocusEmulationEnabled", { enabled: true }),
      url ? evaluate<boolean>(page, `location.href !== "about:blank" && document.readyState === "complete"`).catch(() => false) : true,
    ])
    if (!ready) await loaded
    const info = async () => (await cdp.send("Target.getTargetInfo", { targetId })).targetInfo
    const tab: Tab = {
      id: targetId,
      read: () => read(page),
      act: (step) => act(page, step),
      eval: (expression) => evaluateExpression(page, expression),
      extract: (kind) => extract(page, kind),
      screenshot: (opts) => screenshot(page, opts),
      dialog: () => page.dialog ?? null,
      answerDialog: async (accept, text) => {
        if (!page.dialog) return false
        page.dialog = undefined
        return page.channel
          .send("Page.handleJavaScriptDialog", { accept, promptText: text })
          .then(() => true)
          .catch(() => false)
      },
      url: async () => (await info()).url,
      title: async () => (await info()).title,
      close: async () => {
        page.dialog = undefined
        tabs.delete(targetId)
        await cdp.send("Target.closeTarget", { targetId }).catch(() => {})
      },
    }
    tabs.set(targetId, tab)
    return tab
  }

  cdp.on("Target.targetCreated", ({ targetInfo }) => {
    const opener = targetInfo.openerId
    if (targetInfo.type !== "page" || !opener || !tabs.has(opener)) return
    if (tabs.has(targetInfo.targetId) || opening.has(targetInfo.targetId)) return
    opening.add(targetInfo.targetId)
    adopt(targetInfo.targetId)
      .then((tab) => {
        for (const listener of popupListeners) listener(opener, tab)
      })
      .catch(() => {})
      .finally(() => opening.delete(targetInfo.targetId))
  })
  cdp.on("Target.targetDestroyed", ({ targetId }) => {
    tabs.delete(targetId)
  })
  await cdp.send("Target.setDiscoverTargets", { discover: true })
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: BROWSER.downloadDir }).catch(() => {})

  return {
    openTab: async (url) => {
      const invalid = url === undefined ? undefined : schemeError(url)
      if (invalid) throw new Error(invalid)
      // A background tab in a shared window gets ~0 animation frames, so screenshots took 1.5 s to over 10 s on Kernel.
      // Its own unactivated window keeps it rendering (about 0.3 s) without stealing focus.
      const { targetId } = await cdp.send("Target.createTarget", { url: url ?? "about:blank", background: true, newWindow: true })
      return adopt(targetId, url)
    },
    tab: (id) => tabs.get(id),
    listTabs: async () =>
      Promise.all(
        [...tabs.values()].map(async (tab) => ({ id: tab.id, url: await tab.url(), title: await tab.title() })),
      ),
    onPopup: (listener) => {
      popupListeners.add(listener)
    },
    closed: cdp.closed,
    close: () => cdp.close(),
  }
}
