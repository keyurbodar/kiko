/**
 * True while an input method is composing, or for the key that ends a composition.
 * Safari fires the Enter that commits a composition after `compositionend`, so
 * `isComposing` is false there and only the `229` key code marks it.
 */
export function composingKey(event: Pick<KeyboardEvent, "isComposing" | "keyCode">): boolean {
  return event.isComposing || event.keyCode === 229
}
