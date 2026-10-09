import { Bird } from "./bird"
import { YUKI_BIRD, type BirdState } from "./birds"

/**
 * The brand mark: Yuki in profile, the loaf. `size` is its height. While any agent is working its
 * ink line boils softly, the one sign of life the chrome carries.
 */
export function BrandBird(props: { size: number; working?: boolean }) {
  const state = (): BirdState => (props.working ? "working" : "idle")
  return <Bird spec={YUKI_BIRD} shape="loaf" state={state()} size={props.size} class="brand-bird" />
}
