import { Show, type JSX } from "solid-js"
import { Dialog } from "../../lib/dialog"
import { Button } from "../../settings/kit"

function split(href: string): { host: string; rest: string } {
  try {
    const url = new URL(href)
    const rest = `${url.pathname === "/" ? "" : url.pathname}${url.search}${url.hash}`
    return { host: url.host, rest }
  } catch {
    return { host: href, rest: "" }
  }
}

function openerText(): string | undefined {
  const opener = document.activeElement?.closest('[data-component="chat-masked-link"]')
  return opener?.textContent?.trim() || undefined
}

export function SuspiciousLinkDialog(props: { href: string; text?: string; onClose: () => void }): JSX.Element {
  const says = props.text ?? openerText()
  const target = () => split(props.href)
  const open = () => {
    window.open(props.href, "_blank", "noopener,noreferrer")
    props.onClose()
  }

  return (
    <Dialog
      open
      onClose={props.onClose}
      title="This link goes somewhere else"
      data-component="suspicious-link-dialog"
      footer={
        <div class="flex flex-row-reverse gap-2">
          <Button variant="primary" data-action="go-back" onClick={props.onClose}>
            Go back
          </Button>
          <Button variant="ghost" data-action="open-anyway" onClick={open}>
            Open anyway
          </Button>
        </div>
      }
    >
      <dl class="flex flex-col gap-2 rounded-tile bg-panel px-3.5 py-3" data-component="suspicious-link-detail">
        <Show when={says}>
          {(text) => (
            <div class="grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-2">
              <dt class="type-label text-fg3">Says</dt>
              <dd class="type-ui break-words text-fg">{text()}</dd>
            </div>
          )}
        </Show>
        <div class="grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-2">
          <dt class="type-label text-fg3">Goes to</dt>
          <dd class="font-mono type-label break-all" data-field="real-address">
            <span class="text-fg">{target().host}</span>
            <span class="text-fg3">{target().rest}</span>
          </dd>
        </div>
      </dl>
    </Dialog>
  )
}
