// Element colors scoped to one structure viewer, so two viewers on a page keep their own
// color_scheme and legend-picked colors instead of overwriting one page-wide map.
import type { ColorSchemeName } from '$lib/colors'
import { default_element_colors, ELEMENT_COLOR_SCHEMES } from '$lib/colors'
import { ELEMENT_COLOR_SCHEME_NAMES } from '$lib/constants'
import type { ElementSymbol } from '$lib/element'
import { colors } from '$lib/state.svelte'
import { getContext, setContext } from 'svelte'

// Keyed by symbol string: sites and legends index it with plain element strings
export type ElementColors = Record<string, string>

export interface ElementPalette {
  readonly colors: ElementColors
  set: (element: ElementSymbol, color: string) => void
  reset: (element: ElementSymbol) => void // back to the scheme's color
}

export function scheme_colors(scheme: ColorSchemeName): ElementColors {
  const scheme_map: ElementColors | undefined = ELEMENT_COLOR_SCHEMES[scheme]
  if (scheme_map) return scheme_map
  const valid = ELEMENT_COLOR_SCHEME_NAMES.join(`, `)
  throw new Error(`Unknown color_scheme '${scheme}', expected one of ${valid}`)
}

export class ViewerElementPalette implements ElementPalette {
  // picked colors per scheme, so switching scheme shows that scheme's colors, not a mix
  #picked = $state<Partial<Record<ColorSchemeName, ElementColors>>>({})
  // .by: TS reads a plain $derived(expr) as touching `scheme` before the constructor sets it
  readonly colors = $derived.by(() => ({
    ...scheme_colors(this.scheme()),
    ...this.#picked[this.scheme()],
  }))

  constructor(private readonly scheme: () => ColorSchemeName) {}

  set(element: ElementSymbol, color: string): void {
    const scheme = this.scheme()
    this.#picked[scheme] = { ...this.#picked[scheme], [element]: color }
  }

  reset(element: ElementSymbol): void {
    delete this.#picked[this.scheme()]?.[element]
  }
}

// Outside any viewer (standalone WyckoffTable or scene): the page-wide map
const page_palette: ElementPalette = {
  get colors() {
    return colors.element
  },
  set: (element, color) => (colors.element[element] = color),
  reset: (element) => (colors.element[element] = default_element_colors[element]),
}

const PALETTE_KEY = Symbol(`element-palette`)

export const set_element_palette = (palette: ElementPalette): ElementPalette =>
  setContext(PALETTE_KEY, palette)

// Call during component init: the enclosing viewer's palette, else the page-wide one
export const get_element_palette = (): ElementPalette =>
  getContext<ElementPalette | undefined>(PALETTE_KEY) ?? page_palette
