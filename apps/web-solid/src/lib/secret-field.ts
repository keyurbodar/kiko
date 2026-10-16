/**
 * Props for a field that takes an API key or token. A password field makes the browser offer to save what was
 * typed and fill it in next time, so a deleted or rotated key comes back on its own and fails. A text field
 * drawn as dots (`-webkit-text-security`, in every current browser) is never saved, and the ignore attributes
 * keep 1Password, LastPass, and Bitwarden from filling it.
 */
export const SECRET_FIELD = {
  type: "text",
  autocomplete: "off",
  autocapitalize: "off",
  spellcheck: false,
  style: { "-webkit-text-security": "disc" },
  "data-1p-ignore": "",
  "data-lpignore": "true",
  "data-bwignore": "",
  "data-form-type": "other",
} as const
