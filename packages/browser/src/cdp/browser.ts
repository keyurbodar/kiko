import { act, goto, screenshot } from "../page/act"
import { type PageState, read } from "../page/read"
import type { BrowserSession, DialogPolicy, Tab } from "../page/types"
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
      const accept = policy({ type: dialog.type, message: dialog.message }) === "accept"
      if (!accept) page.dialog = `A ${dialog.type} dialog said: ${dialog.message}`
      page.channel.send("Page.handleJavaScriptDialog", { accept }).catch(() => {})
    })
    page.channel.on("Inspector.targetCrashed", () => {
      page.crashed = true
    })
    await Promise.all([
      page.channel.send("Page.enable"),
      page.channel.send("Emulation.setFocusEmulationEnabled", { enabled: true }),
    ])
    const tab: Tab = {
      id: targetId,
      read: () => read(page),
      act: (step) => act(page, step),
      screenshot: () => screenshot(page),
      close: async () => {
        tabs.delete(targetId)
        await cdp.send("Target.closeTarget", { targetId }).catch(() => {})
      },
    }
    tabs.set(targetId, tab)
    if (url) await goto(page, url)
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

  return {
    openTab: async (url) => {
      // A background tab in a shared window gets ~0 animation frames, so screenshots took 1.5 s to over 10 s on Kernel.
      // Its own unactivated window keeps it rendering (about 0.3 s) without stealing focus.
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", background: true, newWindow: true })
      return adopt(targetId, url)
    },
    tab: (id) => tabs.get(id),
    onPopup: (listener) => {
      popupListeners.add(listener)
    },
    closed: cdp.closed,
    close: () => cdp.close(),
  }
}
