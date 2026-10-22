export function composingKey(event: Pick<KeyboardEvent, "isComposing" | "keyCode">): boolean {
  return event.isComposing || event.keyCode === 229
}

let hardwareKeyboard = false

if (typeof window !== "undefined") {
  const note = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === "Tab" || event.key === " ") hardwareKeyboard = true
  }
  window.addEventListener("keydown", note, { capture: true, passive: true })
}

export function enterIsNewline(event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">): boolean {
  if (event.metaKey || event.ctrlKey) return false
  if (hardwareKeyboard) return false
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches
}
