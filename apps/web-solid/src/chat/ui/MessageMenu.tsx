import { createEffect, createSignal, lazy, Show, Suspense, type JSX } from "solid-js"
import type { ChatMessage } from "../../lib/types"

/** The menu body loads on the first right click or long press, or when the thread is idle. */
const loadView = () => import("./MessageMenuView")
const MessageMenu = lazy(loadView)
export const preloadMessageMenu = () => void loadView()

export interface MessageMenuOptions {
  message: ChatMessage
  side: "user" | "bot"
  pinned?: boolean
  onOpenChange?: (open: boolean) => void
  onReply: () => void
  onTogglePin?: () => void
  onEdit?: () => void
  onDelete?: () => void
  onReact: (emoji: string) => void
}

export interface MessageMenuProps extends MessageMenuOptions {
  ref?: (element: HTMLElement) => void
  style?: JSX.CSSProperties
}

export interface MessageMenuController {
  onContextMenu: (event: MouseEvent) => void
  openAt: (messageId: string, x: number, y: number) => void
  view: JSX.Element
}

export function createMessageMenu(
  options: Omit<MessageMenuOptions, "message"> & { messageFor: (messageId: string) => ChatMessage },
): MessageMenuController & { targetId: () => string | null } {
  const [trigger, setTrigger] = createSignal<HTMLElement>()
  const [targetId, setTargetId] = createSignal<string | null>(null)
  const fallback: ChatMessage = { id: "__none__", threadId: "", sender: "bot", body: "", sentAt: 0 }
  const liveProps = (): MessageMenuProps => {
    const id = targetId()
    return { ...options, message: id === null ? fallback : options.messageFor(id) } as MessageMenuProps
  }
  const view = (
    <Show when={targetId()}>
      <Suspense>
        <MessageMenu {...liveProps()} ref={setTrigger} />
      </Suspense>
    </Show>
  )
  /** Where the menu should open once its body has loaded and its trigger exists. */
  let pending: { x: number; y: number } | null = null
  const fire = () => {
    const at = pending
    const node = trigger()
    if (!at || !node) return
    pending = null
    node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y }))
  }
  createEffect(fire)
  const openAt = (id: string | null, x: number, y: number) => {
    pending = { x, y }
    setTargetId(id)
    fire()
  }
  return {
    targetId,
    onContextMenu: (event) => {
      event.preventDefault()
      const id = (event.currentTarget as HTMLElement | null)?.dataset.messageId
        ?? (event.target as HTMLElement | null)?.closest?.("[data-message-id]")?.getAttribute("data-message-id")
        ?? null
      openAt(id, event.clientX, event.clientY)
    },
    openAt,
    view,
  }
}
