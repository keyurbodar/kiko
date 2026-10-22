import type { FileRef } from "@kiko/protocol"
import { parseRichText } from "@kiko/protocol/markdown"
import { RichText } from "../../chat/rich/RichText"
import { WithText } from "./with-text"

export default function MarkdownView(props: { roomId: string; file: FileRef }) {
	return (
		<WithText roomId={props.roomId} file={props.file}>
			{(text) => (
				<div class="min-h-0 flex-1 overflow-auto" data-component="file-markdown">
					<RichText tree={parseRichText(text)} class="fv-markdown mx-auto max-w-4xl px-6 py-5" />
				</div>
			)}
		</WithText>
	)
}
