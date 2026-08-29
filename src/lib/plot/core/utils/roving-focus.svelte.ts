// Roving tabindex for the Cartesian charts' data marks (scatter points, bars, bins,
// boxes). Exactly one mark carries tabindex=0, so Tab enters the mark group once
// instead of stopping at every one of them; arrow keys then move focus within the
// group. Sunburst/Treemap have the same policy but navigate a tree, so their version
// lives in hierarchy-state.svelte.ts.
//
// Marks are addressed by an opaque string key (`data-roving-key`) rather than a flat
// index, so charts nesting `{#each series}{#each marks}` don't have to maintain a
// series -> offset table. Navigation order is DOM order.

const NEXT_KEYS = new Set([`ArrowRight`, `ArrowDown`])
const PREV_KEYS = new Set([`ArrowLeft`, `ArrowUp`])

export const ROVING_ATTR = `data-roving-key`

// Compose the key a chart puts on a mark. Marks of different series can repeat their
// own index, so the series has to be part of it.
export const roving_key = (series_idx: number, mark_idx: number): string =>
  `${series_idx}:${mark_idx}`

export interface RovingFocus {
  // Set `tabindex` directly rather than via a spread: props reaching an element
  // through a child component's `{...rest}` land a cycle later, which would leave the
  // group with no tab stop on the render that first paints its marks.
  tabindex: (key: string) => 0 | -1
  // Wire to the mark group's `onfocusin` so the tab stop follows the user
  focusin: (event: FocusEvent) => void
  // Wire to the mark group's `onkeydown`. Returns true when it moved focus, so the
  // caller can skip its own handling (activation keys are left to the caller).
  handle_keydown: (event: KeyboardEvent) => boolean
}

export function create_roving_focus(opts: {
  container: () => Element | null | undefined
  // Whatever the chart's rendered marks depend on (its series, its zoom window).
  // Changing it starts a new claim pass and re-checks the focused key.
  marks: () => unknown
}): RovingFocus {
  let focused_key = $state<string | null>(null)
  // The settled fallback: the first mark in DOM order, measured after render. DOM order
  // is the only source that agrees with what the user sees - Svelte re-evaluates marks
  // in no guaranteed order on an update, so "whichever asked first" lands on an
  // arbitrary mark and makes the tab stop jump between renders.
  let fallback_key = $state<string | null>(null)

  const mark_at = (key: string): SVGElement | null =>
    opts.container()?.querySelector(`[${ROVING_ATTR}="${CSS.escape(key)}"]`) ?? null

  // Claimed during the render itself by the first mark to ask, and reset whenever the
  // mark set changes. Only a stopgap for the cycle before the measurement below lands:
  // with no tab stop at all, Tab skips the group and keyboard users cannot reach a mark.
  // Which mark it picks is arbitrary, so `fallback_key` outranks it as soon as it exists.
  const pass = $derived.by(() => {
    opts.marks()
    return { fallback: null as string | null }
  })

  $effect(() => {
    opts.marks()
    // A key left behind by marks that no longer render would strand the group at -1
    if (focused_key != null && !mark_at(focused_key)) focused_key = null
    // Assigning an unchanged primitive to $state is already a no-op, so no guard here
    fallback_key =
      opts.container()?.querySelector(`[${ROVING_ATTR}]`)?.getAttribute(ROVING_ATTR) ?? null
  })

  return {
    tabindex: (key) => {
      pass.fallback ??= key
      return key === (focused_key ?? fallback_key ?? pass.fallback) ? 0 : -1
    },
    focusin: (event) => {
      const key = (event.target as Element | null)
        ?.closest?.(`[${ROVING_ATTR}]`)
        ?.getAttribute(ROVING_ATTR)
      if (key != null) focused_key = key
    },
    handle_keydown: (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return false // page scroll
      const is_next = NEXT_KEYS.has(event.key)
      const is_prev = PREV_KEYS.has(event.key)
      if (!is_next && !is_prev && event.key !== `Home` && event.key !== `End`) return false
      const container = opts.container()
      if (!container) return false
      const marks = [...container.querySelectorAll<SVGElement>(`[${ROVING_ATTR}]`)]
      if (marks.length === 0) return false

      const current = (event.target as Element | null)?.closest?.(`[${ROVING_ATTR}]`)
      const current_idx = current ? marks.indexOf(current as SVGElement) : -1
      let next_idx = 0
      if (event.key === `End`) next_idx = marks.length - 1
      else if (event.key !== `Home` && current_idx >= 0) {
        // Wrap, so arrowing off either end lands back inside the group
        next_idx = (current_idx + (is_next ? 1 : -1) + marks.length) % marks.length
      }
      const target = marks[next_idx]
      if (!target) return false
      event.preventDefault()
      focused_key = target.getAttribute(ROVING_ATTR)
      target.focus() // SVGElement implements HTMLOrSVGElement, so this is not a cast site
      return true
    },
  }
}
