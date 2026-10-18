import { Sky } from "../../sky/Sky"
import { KikoMark } from "../../lib/brand"

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
export function Backdrop() {
  return <Sky kind="bokeh" size="scene" />
}
