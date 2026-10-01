import type { ChatMessage } from "../../lib/types";
import { mediaThumbnail } from "./media";

export type ReplySummary = {
  text: string;
  thumb?: string;
  glyph?: "document" | "link";
};

const REPLY_QUOTE_MAX_CHARS = 140;

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const EMOJI_UNIT = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{1,2})$/u;
const EMOJI_VARIATION = /[\uFE0E\uFE0F]/gu;
const SKIN_TONE = /[\u{1F3FB}-\u{1F3FF}]/gu;
const ZERO_WIDTH_JOINER = /\u200D/u;
const KEYCAP = /\u20E3/u;
const URL_ONLY = /^https?:\/\/\S+$/i;

export function graphemes(value: string): string[] {
  return Array.from(GRAPHEMES.segment(value), (part) => part.segment);
}

export function replyQuoteText(parent: string | null | undefined): string {
  if (!parent) return "";
  const collapsed = parent.replace(/\s+/g, " ").trim();
  if (collapsed.length <= REPLY_QUOTE_MAX_CHARS) return collapsed;

  let out = "";
  for (const part of graphemes(collapsed)) {
    if (out.length + part.length > REPLY_QUOTE_MAX_CHARS) break;
    out += part;
  }
  return `${out}…`;
}

function mediaLabel(media: NonNullable<ChatMessage["media"]>): string {
  if (media.length > 1) return "Album";
  return media[0]?.kind === "video" ? "Video" : "Photo";
}

function documentLabel(documents: NonNullable<ChatMessage["documents"]>): string {
  const first = documents[0]?.name ?? "";
  return documents.length > 1 ? `${first} and ${documents.length - 1} more` : first;
}

export function replySummary(message: ChatMessage): ReplySummary {
  const thumb = mediaThumbnail(message.media?.[0]);
  const media = message.media ?? [];
  const documents = message.documents ?? [];
  const webPage = message.webPage;
  const body = message.body.trim();
  const linkOnly = webPage !== undefined && (body === "" || URL_ONLY.test(body));

  let text = "";
  if (linkOnly) text = webPage.title || webPage.site || webPage.url;
  else if (body !== "") text = replyQuoteText(body);
  else if (media.length > 0) text = mediaLabel(media);
  else if (documents.length > 0) text = documentLabel(documents);

  const summary: ReplySummary = { text };
  if (thumb) summary.thumb = thumb;
  else if (documents.length > 0) summary.glyph = "document";
  else if (linkOnly) summary.glyph = "link";
  return summary;
}

function isEmoji(grapheme: string): boolean {
  if (KEYCAP.test(grapheme)) return true;
  const base = grapheme.replace(EMOJI_VARIATION, "").replace(SKIN_TONE, "");
  return base.split(ZERO_WIDTH_JOINER).every((unit) => EMOJI_UNIT.test(unit));
}

export function jumboEmojiClass(body: string): "jumbo-single" | "jumbo-group" | undefined {
  const parts = graphemes(body.trim());
  if (parts.length < 1 || parts.length > 3) return undefined;
  if (!parts.every(isEmoji)) return undefined;
  return parts.length === 1 ? "jumbo-single" : "jumbo-group";
}
