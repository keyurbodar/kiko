import { type JSX } from "solid-js"
import { ModalV2 } from "@kiko/ui/v2/modal-v2"

/**
 * The confirm a link gets when its visible text and its destination disagree.
 *
 * This is tweb's masked-link rule (`showMaskedAlert`, `wrapRichText.ts:626`),
 * which it reaches for when `isSuspiciousUrl` sees a host whose scripts mix in
 * a way no registry allows — a cyrillic or greek label beside a latin one, the
 * classic whole-script homograph. The link still renders and still looks like
 * the text the sender typed, because hiding it would hide the message; what
 * changes is that nothing navigates until the reader has been shown the REAL
 * host. `RichText` drops the anchor's `href` for these, so there is no
 * middle-click or keyboard path around this dialog either.
 *
 * The shell is `ModalV2`, so the focus trap, escape, the scroll lock and the
 * focus restore are Kobalte's. Cancel is the first button and takes focus, so
 * the default answer to a dialog that only appears when something looks wrong
 * is "no".
 */
export function SuspiciousLinkDialog(props: { href: string; onClose: () => void }): JSX.Element {
  /** The host the link would really open, which is the whole point of the dialog. */
  const realHost = () => {
    try {
      return new URL(props.href).host
    } catch {
      // A url the parser rejects is exactly as suspect as one that parses.
      return props.href
    }
  }

  return (
    <ModalV2
      open
      onOpenChange={(isOpen: boolean) => {
        if (!isOpen) props.onClose()
      }}
    >
      <ModalV2.Portal>
        <ModalV2.Overlay />
        <ModalV2.Content
          class="flex w-[min(420px,calc(100vw-32px))] flex-col gap-2 rounded-[calc(20px*var(--brm))] bg-menu p-4 text-text shadow-popover"
          onPointerDownOutside={() => props.onClose()}
        >
          <ModalV2.Title class="text-base font-[var(--font-weight-bold)] lowercase">
            this link may not go where it says
          </ModalV2.Title>
          <p class="text-sm text-weak">
            The address is written in mixed scripts, which is how a look-alike
            host is spelled. It opens{" "}
            <span class="font-mono break-all text-accent">{realHost()}</span>.
          </p>
          <div class="mt-1 flex justify-end gap-2">
            <button
              type="button"
              class="cursor-pointer rounded-[calc(10px*var(--brm))] px-3 py-1.5 text-sm lowercase hover:bg-btn"
              onClick={() => props.onClose()}
            >
              cancel
            </button>
            <button
              type="button"
              class="cursor-pointer rounded-[calc(10px*var(--brm))] bg-accent-fill px-3 py-1.5 text-sm lowercase text-text hover:bg-btn-hover"
              onClick={() => {
                window.open(props.href, "_blank", "noopener,noreferrer")
                props.onClose()
              }}
            >
              open anyway
            </button>
          </div>
        </ModalV2.Content>
      </ModalV2.Portal>
    </ModalV2>
  )
}
