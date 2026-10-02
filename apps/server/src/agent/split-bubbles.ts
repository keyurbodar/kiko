export const DRAFT_THRESHOLD = 400;
const MAX_TAG = 96;
const TAG_PREFIX = "[react:";
const FENCE = /^ {0,3}(```|~~~)/;
const TAG = /^\[react:([^\]\s:]+)(?::([^\]\s]+))?\]$/;

export type Reaction = { emoji: string; messageId?: string };

export type SplitOutput = {
	/** Blocks closed by this call, in order, trimmed. */
	blocks: string[];
	/** Text of the still-open block when it is past the draft threshold, else null. */
	draft: string | null;
	reactions: Reaction[];
};

export type Splitter = {
	push(chunk: string): SplitOutput;
	end(): SplitOutput;
};

/** Could `buf` still become a complete reaction tag with more input? */
function couldBeTag(buf: string): boolean {
	if (buf.length > MAX_TAG) return false;
	if (buf.length <= TAG_PREFIX.length) return TAG_PREFIX.startsWith(buf);
	if (!buf.startsWith(TAG_PREFIX)) return false;
	const body = buf.slice(TAG_PREFIX.length);
	const close = body.indexOf("]");
	if (close !== -1) return close === body.length - 1 && TAG.test(buf);
	return !/\s/.test(body) && !body.includes("[") && !body.startsWith(":");
}

export function createSplitter(): Splitter {
	let block = "";
	let line = "";
	let fence = false;
	let candidate = "";
	let blocks: string[] = [];
	let reactions: Reaction[] = [];

	const close = () => {
		const text = block.trim();
		if (text) blocks.push(text);
		block = "";
	};

	const text = (ch: string) => {
		if (ch === "\n") {
			if (FENCE.test(line)) fence = !fence;
			const blank = line.trim() === "";
			line = "";
			if (blank && !fence) {
				close();
				return;
			}
			if (block === "" && blank) return;
			block += "\n";
			return;
		}
		line += ch;
		block += ch;
	};

	const flushCandidate = () => {
		const flushed = candidate;
		candidate = "";
		for (const c of flushed) text(c);
	};

	const feed = (ch: string) => {
		if (candidate) {
			const next = candidate + ch;
			if (couldBeTag(next)) {
				candidate = next;
				if (next.endsWith("]")) {
					const m = TAG.exec(next);
					if (m) reactions.push(m[2] ? { emoji: m[1]!, messageId: m[2] } : { emoji: m[1]! });
					candidate = "";
				}
				return;
			}
			flushCandidate();
		}
		if (ch === "[" && !fence) {
			candidate = ch;
			return;
		}
		text(ch);
	};

	const take = (withDraft: boolean): SplitOutput => {
		let draft: string | null = null;
		if (withDraft) {
			const open = block.trim();
			if (open.length > DRAFT_THRESHOLD) draft = open.replace(/[\ud800-\udbff]$/, "");
		}
		const out = { blocks, draft, reactions };
		blocks = [];
		reactions = [];
		return out;
	};

	return {
		push(chunk) {
			for (let i = 0; i < chunk.length; i++) feed(chunk[i]!);
			return take(true);
		},
		end() {
			flushCandidate();
			close();
			return take(false);
		},
	};
}
