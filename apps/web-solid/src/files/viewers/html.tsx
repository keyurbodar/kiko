import type { FileRef } from "@kiko/protocol"
import { createMemo, onCleanup } from "solid-js"
import { WithText } from "./with-text"

/*
 * An HTML file, rendered in a sandboxed frame, as t3code's preview does. The file route sends
 * `content-security-policy: sandbox`, which would stop its scripts, so the page is shown from a
 * blob URL with its own sandbox: scripts, forms and popups, and never the app's origin.
 */
export default function HtmlView(props: { roomId: string; file: FileRef }) {
	return (
		<WithText roomId={props.roomId} file={props.file}>
			{(text) => {
				const url = createMemo(() => URL.createObjectURL(new Blob([text], { type: "text/html" })))
				onCleanup(() => URL.revokeObjectURL(url()))
				return (
					<iframe
						class="min-h-0 flex-1 border-0 bg-white"
						src={url()}
						title={props.file.name}
						sandbox="allow-scripts allow-forms allow-popups"
						data-component="file-html"
					/>
				)
			}}
		</WithText>
	)
}
