export type KeyProblemText = { readonly sentence: string; readonly status?: number }

const STATUS_SUFFIX = /^(.*) · (\d{3})$/

export function splitKeyProblemText(message: string): KeyProblemText {
  const match = STATUS_SUFFIX.exec(message)
  return match ? { sentence: match[1]!, status: Number(match[2]) } : { sentence: message }
}
