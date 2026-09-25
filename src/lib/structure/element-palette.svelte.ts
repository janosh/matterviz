// Element colors scoped to one structure viewer. Each Structure resolves its own color_scheme
// plus the colors picked in its legend, so two viewers on a page (gallery cards, side-by-side
// comparisons) keep their own schemes instead of overwriting one page-wide map.
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

// Fail fast: an unknown name used to set every element color to undefined
export function scheme_colors(scheme: ColorSchemeName): ElementColors {
  const scheme_map: ElementColors | undefined = ELEMENT_COLOR_SCHEMES[scheme]
  if (!scheme_map) {
    throw new Error(
      `Unknown color_scheme '${scheme}', expected one of ${ELEMENT_COLOR_SCHEME_NAMES.join(`, `)}`,
    )
  }
  return scheme_map
}

// A viewer's palette. Picked colors belong to the scheme they were picked under, so switching
// scheme shows that scheme's colors rather than a mix.
export class ViewerElementPalette implements ElementPalette {
  private picked = $state.raw<{ scheme?: ColorSchemeName; colors: ElementColors }>({
    colors: {},
  })
  // $derived.by: the scheme getter is a constructor parameter, assigned after field initializers
  private readonly picked_colors = $derived.by(() =>
    this.picked.scheme === this.scheme() ? this.picked.colors : {},
  )
  readonly colors = $derived.by(() => ({
    ...scheme_colors(this.scheme()),
    ...this.picked_colors,
  }))

  constructor(private readonly scheme: () => ColorSchemeName) {}

  set(element: ElementSymbol, color: string): void {
    this.picked = {
      scheme: this.scheme(),
      colors: { ...this.picked_colors, [element]: color },
    }
  }

  reset(element: ElementSymbol): void {
    const { [element]: _reset, ...kept } = this.picked_colors
    this.picked = { scheme: this.scheme(), colors: kept }
  }
}

// Components rendered outside any viewer (a standalone WyckoffTable or scene) use the
// page-wide map in $lib/state, the one the periodic table colors from
const page_palette: ElementPalette = {
  get colors() {
    return colors.element
  },
  set: (element, color) => {
    colors.element[element] = color
  },
  reset: (element) => {
    colors.element[element] = default_element_colors[element]
  },
}

const PALETTE_KEY = Symbol(`element-palette`)

export const set_element_palette = (palette: ElementPalette): ElementPalette =>
  setContext(PALETTE_KEY, palette)

// Call during component init: the enclosing viewer's palette, else the page-wide one
export const get_element_palette = (): ElementPalette =>
  getContext<ElementPalette | undefined>(PALETTE_KEY) ?? page_palette
