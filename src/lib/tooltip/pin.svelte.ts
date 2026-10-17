// One pinned tooltip per component. A click on the hovered mark pins its tooltip: it stays
// while the pointer moves on, other hovers don't replace it, and PlotTooltip's `pinned` makes
// its text selectable. Clicking the pinned mark again or empty space (`toggle` with nothing
// hovered) and Escape (`unpin`, from the component's own key handling) release it. `key`
// names the mark, so a fresher snapshot of the same mark still counts as the pinned one.
// `enabled` false for a mark (the tooltip is off, or the host claimed its click) makes a click
// on it only unpin.
export class TooltipPin<T> {
  value = $state.raw<T | null>(null)
  readonly #key: (value: T) => unknown
  readonly #enabled: (value: T) => boolean
  readonly #on_unpin: (() => void) | undefined

  constructor(
    options: {
      key?: (value: T) => unknown
      enabled?: (value: T) => boolean
      on_unpin?: () => void
    } = {},
  ) {
    this.#key = options.key ?? ((value) => value)
    this.#enabled = options.enabled ?? (() => true)
    this.#on_unpin = options.on_unpin
  }

  is = (value: T | null | undefined): boolean =>
    value != null && this.value !== null && this.#key(value) === this.#key(this.value)

  // Whether hovering `value` may update the tooltip: nothing pinned, or it's the pinned mark
  allows = (value: T): boolean => this.value === null || this.is(value)

  // A click on `value`, or on empty space when nullish
  toggle = (value: T | null | undefined): void => {
    if (value == null || this.is(value) || !this.#enabled(value)) this.unpin()
    else this.value = value
  }

  // False when nothing was pinned, so viewer_keys leaves Escape to the host
  unpin = (): boolean => {
    if (this.value === null) return false
    this.value = null
    this.#on_unpin?.()
    return true
  }
}
