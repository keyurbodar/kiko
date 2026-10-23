import { loadEmoji } from "../lib/emoji-data"
import { whenIdle } from "../lib/idle"
import { startServiceWorker } from "./service-worker"

const CONCURRENCY = 3

const lazyModules: Array<() => Promise<unknown>> = [
  () => import("../chat/rich/RichText"),
  () => import("../chat/side/Sidecar"),
  () => import("../palette/palette"),
  () => import("../search/overlay"),
  () => import("../composer/prompt-input/extras"),
  () => import("../chat/ui/EmojiPicker"),
  loadEmoji,
  () => import("../composer/cards/composer-cards"),
  () => import("../chat/side/card"),
  () => import("../commands/HintLayer"),
  () => import("../chat/bot-picker"),
  () => import("../recipes/page"),
  () => import("../sidebar/recipes/sidebar"),
  () => import("./connect"),
  () => import("../newagent/dialog"),
  () => import("../avatar/picker"),
  () => import("../sidebar/delete-chat-dialog"),
  () => import("../chat/ui/ReactionPopover"),
  () => import("../chat/ui/ImageDialog"),
  () => import("../chat/ui/DateCalendar"),
  () => import("../chat/ui/SuspiciousLinkDialog"),
  () => import("../chat/QuoteOnSelect"),
  () => import("../settings/keyboard"),
]

function warmLazyModules(): Promise<void> {
  const queue = [...lazyModules]
  let active = CONCURRENCY
  return new Promise((resolve) => {
    const next = () => {
      const load = queue.shift()
      if (!load) {
        if (--active === 0) resolve()
        return
      }
      void load()
        .catch(() => {})
        .finally(() => whenIdle(next))
    }
    for (let i = 0; i < CONCURRENCY; i++) whenIdle(next)
  })
}

export function warmApp(): void {
  startServiceWorker(warmLazyModules())
}
