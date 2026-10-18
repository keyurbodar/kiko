import { Sky } from "../../sky/Sky"
import { KikoMark } from "../../lib/brand"

/** The mark, breathing, with a blink. One drawing, the same one as the favicon and the sidebar. */
export function Mascot() {
  return (
    <div class="welcome-mascot" aria-hidden="true">
      <KikoMark class="welcome-mascot-mark" />
    </div>
  )
}

/**
 * The onboarding backdrop: the bokeh sky, the same component the sidebar's band draws, at full
 * height. Nothing else sits behind the card, so the step is the only thing asking for attention.
 */
export function Backdrop(_props: { busy: boolean }) {
  return <Sky kind="bokeh" size="scene" />
}
