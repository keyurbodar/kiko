import type { FileRef } from "@yuki/protocol"
// ASSUMPTION: a markdown file renders with the same parser the room uses for agent messages, so a
// file and a message that hold the same markdown look the same. The parser is pure (marked and
// the protocol types), and this chunk loads only when a markdown file renders, in tier 4.
import { parseRichText } from "../../../../server/src/room/rich-text"
import { RichText } from "../../chat/rich/RichText"
import { WithText } from "./with-text"

/** A markdown file, rendered. */
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
