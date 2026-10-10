import { onMount, type JSX } from "solid-js"
import { BrowserButtons } from "./BrowserChip"
import { startBrowser } from "./browser"

/** The buttons under an agent's browser share card. The card's text is the reason, and no link is in it. */
export default function ShareCard(): JSX.Element {
	onMount(startBrowser)
	return (
		<div class="px-(--bubble-pad-x) pt-2 pb-1" data-component="share-card">
			<BrowserButtons />
		</div>
	)
}
