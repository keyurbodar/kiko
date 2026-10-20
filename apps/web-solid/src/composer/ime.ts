export function composingKey(event: Pick<KeyboardEvent, "isComposing" | "keyCode">): boolean {
  return event.isComposing || event.keyCode === 229
}

export function enterIsNewline(event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">): boolean {
  return !event.metaKey && !event.ctrlKey && typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches
}
