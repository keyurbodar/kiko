import type { ChatMessage } from "../../lib/types";
import { splitFiles } from "../../lib/attachments";

export type ReplySummary = {
  text: string;
  thumb?: string;
  /** The first file's name: its icon stands in for the thumbnail. */
  glyph?: string;
};

const REPLY_QUOTE_MAX_CHARS = 140;

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const EMOJI_UNIT = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{1,2})$/u;
const EMOJI_VARIATION = /[\uFE0E\uFE0F]/gu;
const SKIN_TONE = /[\u{1F3FB}-\u{1F3FF}]/gu;
const ZERO_WIDTH_JOINER = /\u200D/u;
const KEYCAP = /\u20E3/u;

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

/** What a message of only attachments is called in a quote: `Photo`, `3 photos`, or its first file. */
function filesLabel(images: number, others: readonly { name: string }[]): string {
  if (others.length === 0) return images > 1 ? `${images} photos` : "Photo";
  const rest = images + others.length - 1;
  return rest > 0 ? `${others[0]!.name} and ${rest} more` : others[0]!.name;
}

/** The reply header for a quote: the words the sender picked, in quote marks, cut like any reply. */
export function quoteSummary(quote: string): ReplySummary {
  return { text: `“${replyQuoteText(quote)}”` };
}

export function replySummary(message: ChatMessage): ReplySummary {
  const { images, others } = splitFiles(message.files ?? []);
  const body = message.body.trim();
  const text = body !== "" ? replyQuoteText(body) : images.length + others.length > 0 ? filesLabel(images.length, others) : "";
  const summary: ReplySummary = { text };
  if (images[0]) summary.thumb = images[0].src;
  else if (others.length > 0) summary.glyph = others[0]!.name;
  return summary;
}

/** What a reply shows above its words: who and what it answers, and whether a tap can still find it. */
export type QuoteModel = {
  /** The message it answers. */
  id: string;
  /** Where that message sits, so a tap can load it when it is not in the window. */
  seq?: number;
  label: string;
  summary: ReplySummary;
  /** The original was deleted: the quote stays, with no words and nowhere to go. */
  gone: boolean;
  /** The agent whose words these are, for its colour in a group. */
  botId?: string;
};

/**
 * The quote of a reply, from the original when the window holds it, else from what the room sent
 * with the reply. Null when there is nothing to quote, such as a reply to a system line.
 */
export function quoteOf(message: ChatMessage, parent: ChatMessage | undefined, name: (slug: string) => string | undefined): QuoteModel | null {
  const id = message.replyToId;
  if (!id) return null;
  const chosen = message.quote ? quoteSummary(message.quote) : undefined;
  if (parent) {
    const model: QuoteModel = { id, label: parent.sender === "user" ? "You" : (name(parent.botId ?? "") ?? "Bot"), summary: chosen ?? replySummary(parent), gone: false };
    if (parent.seq !== undefined) model.seq = parent.seq;
    if (parent.botId !== undefined) model.botId = parent.botId;
    return model;
  }
  const kept = message.reply;
  if (!kept) return null;
  const botId = kept.from.kind === "agent" ? kept.from.slug : undefined;
  const label = botId === undefined ? "You" : (name(botId) ?? botId);
  const model: QuoteModel = { id, seq: kept.seq, label, summary: kept.gone ? { text: "Deleted message" } : (chosen ?? { text: kept.text }), gone: kept.gone === true };
  if (botId !== undefined) model.botId = botId;
  return model;
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
