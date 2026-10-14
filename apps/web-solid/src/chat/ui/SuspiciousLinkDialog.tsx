import type { JSX } from "solid-js"
import { Dialog } from "../../lib/dialog"
import { Button } from "../../settings/kit"

export function SuspiciousLinkDialog(props: { href: string; onClose: () => void }): JSX.Element {
  const realHost = () => {
    try {
      return new URL(props.href).host
    } catch {
      return props.href
    }
  }

  return (
    <Dialog
      open
      onClose={props.onClose}
      title="This link may not go where it says"
      data-component="suspicious-link-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            data-action="open-anyway"
            onClick={() => {
              window.open(props.href, "_blank", "noopener,noreferrer")
              props.onClose()
            }}
          >
            Open anyway
          </Button>
        </>
      }
    >
      <p class="text-[13px] leading-relaxed text-[var(--kit-meta)]">
        The text of this link does not match its address. It opens <span class="font-mono break-words text-ring">{realHost()}</span>.
      </p>
    </Dialog>
  )
}
