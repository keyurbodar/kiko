const ALPHA_CHARS_REG_EXP =
  "a-z" +
  "\\u00c0-\\u00d6\\u00d8-\\u00f6\\u00f8-\\u00ff" +
  "\\u0100-\\u024f" +
  "\\u0253\\u0254\\u0256\\u0257\\u0259\\u025b\\u0263\\u0268\\u026f\\u0272\\u0289\\u028b" +
  "\\u02bb" +
  "\\u0300-\\u036f" +
  "\\u1e00-\\u1eff" +
  "\\u0400-\\u04ff\\u0500-\\u0527" +
  "\\u2de0-\\u2dff\\ua640-\\ua69f" +
  "\\u0591-\\u05bf\\u05c1-\\u05c2\\u05c4-\\u05c5\\u05c7" +
  "\\u05d0-\\u05ea\\u05f0-\\u05f4" +
  "\\ufb1d-\\ufb28\\ufb2a-\\ufb36\\ufb38-\\ufb3c\\ufb3e\\ufb40-\\ufb41" +
  "\\ufb43-\\ufb44\\ufb46-\\ufb4f" +
  "\\u0610-\\u061a\\u0620-\\u065f\\u066e-\\u06d3\\u06d5-\\u06dc" +
  "\\u06de-\\u06e8\\u06ea-\\u06ef\\u06fa-\\u06fc\\u06ff" +
  "\\u0750-\\u077f\\u08a0\\u08a2-\\u08ac\\u08e4-\\u08fe" +
  "\\ufb50-\\ufbb1\\ufbd3-\\ufd3d\\ufd50-\\ufd8f\\ufd92-\\ufdc7\\ufdf0-\\ufdfb" +
  "\\ufe70-\\ufe74\\ufe76-\\ufefc" +
  "\\u200c" +
  "\\u0e01-\\u0e3a\\u0e40-\\u0e4e" +
  "\\u1100-\\u11ff\\u3130-\\u3185\\uA960-\\uA97F\\uAC00-\\uD7AF\\uD7B0-\\uD7FF" +
  "\\u3003\\u3005\\u303b" +
  "\\uff21-\\uff3a\\uff41-\\uff5a" +
  "\\uff66-\\uff9f" +
  "\\uffa1-\\uffdc"

const ALPHA_NUMERIC_REG_EXP = "0-9\\_" + ALPHA_CHARS_REG_EXP

const DOMAIN_ADD_CHARS = "\\u00b7"

const URL_ALPHANUMERIC_REG_EXP_PART = "[" + ALPHA_CHARS_REG_EXP + "0-9]"

const URL_PROTOCOL_REG_EXP_PART = "(?<protocol>(?:https?|ftp)://|mailto:)?"

const MENTION_BODY_REG_EXP = "[a-zA-Z\\d_]{2,32}"

const URL_REG_EXP =
  URL_PROTOCOL_REG_EXP_PART +
  "(?:" +
  URL_ALPHANUMERIC_REG_EXP_PART +
  "{1,64}(?::" +
  URL_ALPHANUMERIC_REG_EXP_PART +
  "{0,64})?@)?" +
  "(?:" +
  "(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])(?:\\.(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])){3}" +
  "|" +
  URL_ALPHANUMERIC_REG_EXP_PART +
  "[" +
  ALPHA_CHARS_REG_EXP +
  DOMAIN_ADD_CHARS +
  "0-9\\-]{0,64}" +
  "(?:\\." +
  URL_ALPHANUMERIC_REG_EXP_PART +
  "[" +
  ALPHA_CHARS_REG_EXP +
  DOMAIN_ADD_CHARS +
  "0-9\\-]{0,64}){0,10}" +
  "(?:\\.(?<tld>xn--[0-9a-z]{2,16}|[" +
  ALPHA_CHARS_REG_EXP +
  "]{2,24}))" +
  ")" +
  "(?::\\d{1,5})?" +
  "(?:/(?:\\S{0,255}[^\\s.;,!?:(\\[\\]{}<>\"'])?)?"

const USERNAME_REG_EXP = "[a-zA-Z\\d_]{5,32}"

const TAG_REG_EXP = "(?:#[" + ALPHA_NUMERIC_REG_EXP + "]{2,64})(?:@" + USERNAME_REG_EXP + ")?"

export const FULL_REG_EXP = new RegExp(
  "(?<mentionPrefix>^|[\\s(])(?<mentionAt>@)(?<mentionBody>" +
    MENTION_BODY_REG_EXP +
    ")" +
    "|(?<url>" +
    URL_REG_EXP +
    ")" +
    "|(?<tagPrefix>^|[\\s(])(?<hashtag>" +
    TAG_REG_EXP +
    ")",
  "i",
)

export const EMAIL_REG_EXP =
  /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
