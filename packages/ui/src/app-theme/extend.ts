// Kiko extensions on top of the t3 role engine. New code (not copied):
// typography, sugar-high, and markdown/syntax token bridges emitted as CSS vars.

export interface ThemeTypography {
  fontSans?: string;
  fontMono?: string;
  fontSizeBase?: string;
  fontSizeSmall?: string;
  fontSizeLarge?: string;
  fontSizeCode?: string;
  lineHeight?: string;
}

export type SugarToken =
  | "class"
  | "identifier"
  | "sign"
  | "property"
  | "entity"
  | "jsxliterals"
  | "string"
  | "keyword"
  | "comment";

export type MarkdownToken =
  | "markdown-heading"
  | "markdown-text"
  | "markdown-link"
  | "markdown-link-text"
  | "markdown-code"
  | "markdown-block-quote"
  | "markdown-emph"
  | "markdown-strong";

export type SyntaxToken =
  | "syntax-comment"
  | "syntax-keyword"
  | "syntax-string"
  | "syntax-primitive"
  | "syntax-variable"
  | "syntax-property"
  | "syntax-type"
  | "syntax-constant"
  | "syntax-operator"
  | "syntax-punctuation"
  | "syntax-object";

export interface AppThemeExtensions {
  typography?: ThemeTypography;
  sugar?: Partial<Record<SugarToken, string>>;
  markdown?: Partial<Record<MarkdownToken, string>>;
  syntax?: Partial<Record<SyntaxToken, string>>;
}

const TYPOGRAPHY_TOKENS = {
  "font-family-sans": "fontSans",
  "font-family-mono": "fontMono",
  "font-size-base": "fontSizeBase",
  "font-size-small": "fontSizeSmall",
  "font-size-large": "fontSizeLarge",
  "font-size-code": "fontSizeCode",
  "line-height-large": "lineHeight",
} as const satisfies Record<string, keyof ThemeTypography>;

/** Emit extension vars onto root; only set entries are written. */
export function applyAppThemeExtensions(extensions: AppThemeExtensions): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root?.style) return;
  const { typography, sugar, markdown, syntax } = extensions;
  if (typography) {
    for (const [token, field] of Object.entries(TYPOGRAPHY_TOKENS) as Array<
      [string, keyof ThemeTypography]
    >) {
      const value = typography[field];
      if (value !== undefined) root.style.setProperty(`--${token}`, value);
    }
  }
  if (sugar) {
    for (const [token, value] of Object.entries(sugar)) {
      if (value !== undefined) root.style.setProperty(`--sh-${token}`, value);
    }
  }
  if (markdown) {
    for (const [token, value] of Object.entries(markdown)) {
      if (value !== undefined) root.style.setProperty(`--${token}`, value);
    }
  }
  if (syntax) {
    for (const [token, value] of Object.entries(syntax)) {
      if (value !== undefined) root.style.setProperty(`--${token}`, value);
    }
  }
}

/** Resolve extension vars to a token record (no DOM), for tests and SSR. */
export function resolveAppThemeExtensions(
  extensions: AppThemeExtensions,
): Record<string, string> {
  const tokens: Record<string, string> = {};
  const { typography, sugar, markdown, syntax } = extensions;
  if (typography) {
    for (const [token, field] of Object.entries(TYPOGRAPHY_TOKENS) as Array<
      [string, keyof ThemeTypography]
    >) {
      const value = typography[field];
      if (value !== undefined) tokens[token] = value;
    }
  }
  if (sugar) {
    for (const [token, value] of Object.entries(sugar)) {
      if (value !== undefined) tokens[`sh-${token}`] = value;
    }
  }
  if (markdown) {
    for (const [token, value] of Object.entries(markdown)) {
      if (value !== undefined) tokens[token] = value;
    }
  }
  if (syntax) {
    for (const [token, value] of Object.entries(syntax)) {
      if (value !== undefined) tokens[token] = value;
    }
  }
  return tokens;
}
