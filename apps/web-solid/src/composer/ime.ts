export function composingKey(event: Pick<KeyboardEvent, "isComposing" | "keyCode">): boolean {
  return event.isComposing || event.keyCode === 229
}

export function enterIsNewline(event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">): boolean {
  if (event.metaKey || event.ctrlKey) return false
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches
}
