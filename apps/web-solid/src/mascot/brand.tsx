import { Bird } from "./bird"
import { YUKI } from "./birds"
import { SEASON_OUTFIT, seasonOf } from "./scene"

/**
 * The brand mark: Yuki in today's seasonal touch. Pointing at the link or button it sits in
 * tilts its head, at once, with no transition, because the chrome never animates.
 */
export function BrandBird(props: { size: number }) {
  return <Bird spec={{ ...YUKI, outfit: SEASON_OUTFIT[seasonOf(new Date())] }} size={props.size} class="brand-bird" />
}
