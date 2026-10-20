import type { FileRef } from "@kiko/protocol"
import { createMemo, onCleanup } from "solid-js"
import { WithText } from "./with-text"

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
