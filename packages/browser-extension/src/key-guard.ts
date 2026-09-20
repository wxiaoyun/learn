type LearningKeyboardGlobal = typeof globalThis & {
  __learningKeyboardDispatch?: (event: KeyboardEvent, pathContainsHost: boolean) => boolean
}

const hostIds = new Set(["learning-youtube-surface", "learning-youtube-asks"])
const containedKeys = new Set<string>()

for (const type of ["keydown", "keypress", "keyup"] as const) {
  window.addEventListener(type, (event) => {
    const key = event.code || event.key
    const pathContainsHost = event.composedPath().some((value) =>
      value instanceof HTMLElement && hostIds.has(value.id))
    const handled = (globalThis as LearningKeyboardGlobal)
      .__learningKeyboardDispatch?.(event, pathContainsHost) ?? false
    const contain = pathContainsHost || handled || type !== "keydown" && containedKeys.has(key)
    if (type === "keydown" && contain) containedKeys.add(key)
    if (type === "keyup") containedKeys.delete(key)
    if (contain) event.stopImmediatePropagation()
  }, { capture: true })
}
