// The matchers `parseEntities` runs over a message body, ported from tweb's
// `src/lib/richTextProcessor/index.ts` (originally Igor Zhukov's webogram).
//
// The character-class construction is tweb's verbatim and for the same reason it
// was there: a URL in a chat body is written in whatever script the sender has,
// and an ASCII-only URL matcher would silently fail to link a Cyrillic or
// CJK domain — the exact links a homograph attack needs to go unnoticed. The
// breadth is what makes `isSuspiciousUrl` worth running afterwards.
//
// What is NOT verbatim is the entity list. tweb matches Telegram's whole
// entity vocabulary — linebreaks, bot commands, media timestamps, emoji — in
// one alternation. yuki keeps four kinds: mention, url/email, and hashtag, plus
// plain prose for everything the matcher does not claim. Bot commands and
// timestamps are Telegram syntax with no meaning in a yuki transcript, and
// emoji are drawn by `lib/emoji.tsx` off the text itself: an emoji entity here
// would double-claim characters that `EmojiText` also wants to own.
//
// ---------------------------------------------------------------------------
// NAMED GROUPS, NOT NUMBERS
//
// tweb reads its alternation positionally — `match[3]`, `match[4]`, `match[7]` —
// which means every branch added or removed renumbers every group after it. That
// is a silent, load-bearing coupling: dropping the emoji branch shifts the
// hashtag's indices, `parseEntities` reads the wrong group, and nothing fails
// until a hashtag renders as prose. So every group this file's consumers read is
// named, and `parseEntities` reads `match.groups`. The group ORDER is still
// tweb's — mention, then url, then hashtag — so the port stays traceable
// against the original.
//
//   mentionPrefix  the `(^| )` a mention had to start after, so a mention glued
//                  to the end of a word (`mail@name`) is not a mention
//   mentionAt      the `@` itself, so the entity can start after the prefix
//   mentionBody    the username
//   url            the whole run: optional protocol, optional user:pass, host
//                  or IPv4 literal, port, path
//   protocol       the protocol, when the run spelled one
//   tld            the last label of the host, when it had one — the group the
//                  TLD gate reads
//   tagPrefix      the `(^|[\s(])` a tag had to start after
//   hashtag        the tag, with an optional `@username` chat suffix
//
// ---------------------------------------------------------------------------

/**
 * Letters a URL or a mention may be spelled in. Every block is commented with
 * the script it admits, because "why is Thai in here" is a question this class
 * invites and the answer is in tweb.
 */
export const ALPHA_CHARS_REG_EXP =
  "a-z" +
  "\\u00c0-\\u00d6\\u00d8-\\u00f6\\u00f8-\\u00ff" + // Latin-1
  "\\u0100-\\u024f" + // Latin Extended A and B
  "\\u0253\\u0254\\u0256\\u0257\\u0259\\u025b\\u0263\\u0268\\u026f\\u0272\\u0289\\u028b" + // IPA Extensions
  "\\u02bb" + // Hawaiian
  "\\u0300-\\u036f" + // Combining diacritics
  "\\u1e00-\\u1eff" + // Latin Extended Additional (mostly for Vietnamese)
  "\\u0400-\\u04ff\\u0500-\\u0527" + // Cyrillic
  "\\u2de0-\\u2dff\\ua640-\\ua69f" + // Cyrillic Extended A/B
  "\\u0591-\\u05bf\\u05c1-\\u05c2\\u05c4-\\u05c5\\u05c7" +
  "\\u05d0-\\u05ea\\u05f0-\\u05f4" + // Hebrew
  "\\ufb1d-\\ufb28\\ufb2a-\\ufb36\\ufb38-\\ufb3c\\ufb3e\\ufb40-\\ufb41" +
  "\\ufb43-\\ufb44\\ufb46-\\ufb4f" + // Hebrew Pres. Forms A
  "\\u0610-\\u061a\\u0620-\\u065f\\u066e-\\u06d3\\u06d5-\\u06dc" +
  "\\u06de-\\u06e8\\u06ea-\\u06ef\\u06fa-\\u06fc\\u06ff" + // Arabic
  "\\u0750-\\u077f\\u08a0\\u08a2-\\u08ac\\u08e4-\\u08fe" + // Arabic Supplement and Extended A
  "\\ufb50-\\ufbb1\\ufbd3-\\ufd3d\\ufd50-\\ufd8f\\ufd92-\\ufdc7\\ufdf0-\\ufdfb" + // Pres. Forms A
  "\\ufe70-\\ufe74\\ufe76-\\ufefc" + // Pres. Forms B
  "\\u200c" + // Zero-Width Non-Joiner
  "\\u0e01-\\u0e3a\\u0e40-\\u0e4e" + // Thai
  "\\u1100-\\u11ff\\u3130-\\u3185\\uA960-\\uA97F\\uAC00-\\uD7AF\\uD7B0-\\uD7FF" + // Hangul (Korean)
  "\\u3003\\u3005\\u303b" + // Kanji/Han iteration marks
  "\\uff21-\\uff3a\\uff41-\\uff5a" + // full width Alphabet
  "\\uff66-\\uff9f" + // half width Katakana
  "\\uffa1-\\uffdc" // half width Hangul (Korean)

/** ALPHA_CHARS plus digits and `_`, which a tag or a filename may carry. */
export const ALPHA_NUMERIC_REG_EXP = "0-9\\_" + ALPHA_CHARS_REG_EXP

/** The one character a hostname may carry that is not a letter. */
export const DOMAIN_ADD_CHARS = "\\u00b7"

/** Based on Regular Expression for URL validation by Diego Perini */
const URL_ALPHANUMERIC_REG_EXP_PART = "[" + ALPHA_CHARS_REG_EXP + "0-9]"

// `http`, `https`, `ftp` and `mailto` only. The set is deliberately short,
// because this capture feeds `normalizeUrlProtocol`, and a longer set is a
// longer list of schemes a reader can be walked into.
const URL_PROTOCOL_REG_EXP_PART = "(?<protocol>(?:https?|ftp)://|mailto:)?"

// The body a mention may be spelled in, without the `@`.
//
// tweb uses its `USERNAME_REG_EXP` here, which is Telegram's handle shape:
// `[a-zA-Z\d_]{5,32}`, five characters or more because that is the shortest
// thing a Telegram server will let you claim. A yuki transcript has no server to
// arbitrate handles — `@name` is prose somebody typed — and requiring five
// characters means the mention a reader can see in front of them silently
// renders as plain text. The lower bound is therefore 2 (a single letter is far
// more likely to be an `@` in an address we failed to link than a handle), and
// the upper bound is kept at Telegram's, because nothing longer is a mention in
// any reading. `USERNAME_REG_EXP` below still governs the `@username` suffix of
// a chat tag, where the suffix really does name a channel.
const MENTION_BODY_REG_EXP = "[a-zA-Z\\d_]{2,32}"

export const URL_REG_EXP =
  URL_PROTOCOL_REG_EXP_PART +
  // user:pass authentication
  "(?:" +
  URL_ALPHANUMERIC_REG_EXP_PART +
  "{1,64}(?::" +
  URL_ALPHANUMERIC_REG_EXP_PART +
  "{0,64})?@)?" +
  "(?:" +
  // sindresorhus/ip-regexp
  "(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])(?:\\.(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])){3}" +
  "|" +
  // host name
  URL_ALPHANUMERIC_REG_EXP_PART +
  "[" +
  ALPHA_CHARS_REG_EXP +
  DOMAIN_ADD_CHARS +
  "0-9\\-]{0,64}" +
  // domain name
  "(?:\\." +
  URL_ALPHANUMERIC_REG_EXP_PART +
  "[" +
  ALPHA_CHARS_REG_EXP +
  DOMAIN_ADD_CHARS +
  "0-9\\-]{0,64}){0,10}" +
  // TLD identifier
  "(?:\\.(?<tld>xn--[0-9a-z]{2,16}|[" + ALPHA_CHARS_REG_EXP + "]{2,24}))" +
  ")" +
  // port number
  "(?::\\d{1,5})?" +
  // resource path. `\S{0,255}` is greedy and the final character is drawn from a
  // class with the sentence punctuation excluded, so a full stop or a comma ends
  // the path instead of being swallowed by it. That is what keeps
  // `see https://example.com.` from linking the full stop.
  "(?:/(?:\\S{0,255}[^\\s.;,!?:(\\[\\]{}<>\"'])?)?"

/**
 * Whether a string already spells its own protocol, anchored at the start.
 *
 * Anchored, and anchored on the TEXT rather than on a parsed URL: see
 * `normalizeUrlProtocol` for why the difference matters. tweb builds this by
 * slicing the last character off the optional-protocol fragment; here the
 * fragment is spliced whole, so this compiles and names the same group.
 */
export const URL_PROTOCOL_REG_EXP = new RegExp("^" + URL_PROTOCOL_REG_EXP_PART, "i")

/** Telegram's handle shape, kept for the `@username` suffix of a chat tag. */
export const USERNAME_REG_EXP = "[a-zA-Z\\d_]{5,32}"

/**
 * A hashtag, and only a hashtag.
 *
 * tweb's alternation also accepted `\$[A-Z]{1,8}` — a cashtag — and then threw
 * away every cashtag that was not already uppercase, because `$TON` is the shape
 * of a ticker and `$ton` is the shape of someone typing `$` and a word. Cashtags
 * are not a thing in a yuki transcript, so the second alternative is gone rather
 * than half-kept: a `$`-led run now matches nothing at all, which is what the
 * uppercase test was for in the first place.
 *
 * The `2` lower bound is tweb's: a one-letter tag is a heading marker that
 * somebody typed, not a tag.
 */
export const TAG_REG_EXP =
  "(?:#[" + ALPHA_NUMERIC_REG_EXP + "]{2,64})" + "(?:@" + USERNAME_REG_EXP + ")?"

export const FULL_REG_EXP = new RegExp(
  // mention: anchored at the start of the body or after one space, never mid-word
  "(?<mentionPrefix>^|[\\s(])(?<mentionAt>@)(?<mentionBody>" +
    MENTION_BODY_REG_EXP +
    ")" +
    // url, and through it email: the run is matched once and `EMAIL_REG_EXP`
    // decides afterwards, because an address is the same shape as a URL with a
    // `user@` in front of it and only the tail differs
    "|(?<url>" +
    URL_REG_EXP +
    ")" +
    // hashtag: after the start of the body, whitespace, or an opening bracket,
    // so `(see #tag)` tags the tag and not the bracket run
    "|(?<tagPrefix>^|[\\s(])(?<hashtag>" +
    TAG_REG_EXP +
    ")",
  "i",
)

/**
 * A whole-string address, not a run inside prose. The anchors are what make this
 * usable as a discriminator: `me@example.com` is an address, and `me@example`
 * with a scheme-less host behind it is a URL the TLD gate already decided about.
 */
export const EMAIL_REG_EXP =
  /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
