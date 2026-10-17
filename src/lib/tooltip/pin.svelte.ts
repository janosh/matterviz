// One pinned tooltip per component. A click on the hovered mark pins its tooltip: it stays
// while the pointer moves on, other hovers don't replace it, and PlotTooltip's `pinned` makes
// its text selectable. Clicking the pinned mark again or empty space (`toggle` with nothing
// hovered) and Escape (`unpin`, from the component's own key handling) release it. `key`
// names the mark, so a fresher snapshot of the same mark still counts as the pinned one. It
// reads `K`, the part of a pinned `T` that names its mark, so a bare mark compares too.
// `enabled` false for a mark (the tooltip is off, or the host claimed its click) makes a click
// on it only unpin.
// The pinned mark keeps its hover look: per-mark styles follow `lit` (hovered or pinned), and
// one-at-a-time highlights (a halo, a dimmed rest) follow `shown`, the mark the tooltip shows.
// A pointer-anchored tooltip reads its position through `anchored`, which holds it still.
export class TooltipPin<T extends K, K = T> {
  #value = $state.raw<T | null>(null)
  #pin_count = 0 // bumped when a pin starts, not when a fresher snapshot of its mark lands
  readonly #key: (value: K) => unknown
  readonly #enabled: (value: T) => boolean
  readonly #on_unpin: (() => void) | undefined

  constructor(
    options: {
      key?: (value: K) => unknown
      enabled?: (value: T) => boolean
      on_unpin?: () => void
    } = {},
  ) {
    this.#key = options.key ?? ((value) => value)
    this.#enabled = options.enabled ?? (() => true)
    this.#on_unpin = options.on_unpin
  }

  get value(): T | null {
    return this.#value
  }
  set value(next: T | null) {
    if (next !== null && !this.is(next)) this.#pin_count++
    this.#value = next
  }

  is = (value: K | null | undefined): boolean =>
    value != null && this.value !== null && this.#key(value) === this.#key(this.value)

  // Whether `mark` wears its hover look: it is the `hovered` mark or the pinned one
  lit = (mark: K, hovered: K | null | undefined): boolean =>
    this.is(mark) || (hovered != null && this.#key(hovered) === this.#key(mark))

  // The mark the tooltip and any one-at-a-time highlight show: the pinned one, else `hovered`
  shown = <H extends T | null | undefined>(hovered: H): T | H => this.value ?? hovered

  // A tooltip position that holds still while pinned: `live()` until a pin starts, then where
  // it was at that moment, so pointer moves (even over the pinned mark) leave the tooltip put
  anchored = <P>(live: () => P): { readonly current: P } => {
    let frozen: { pin: number; position: P } | null = null
    const read = (): P => {
      if (this.value === null) return live()
      if (frozen?.pin !== this.#pin_count) frozen = { pin: this.#pin_count, position: live() }
      return frozen.position
    }
    return {
      get current() {
        return read()
      },
    }
  }

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

// A TooltipPin over hovers that name their mark in `mark`
export const mark_pin = <T extends { mark: string }>(): TooltipPin<T> =>
  new TooltipPin<T>({ key: ({ mark }) => mark })
