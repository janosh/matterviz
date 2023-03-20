import { session_store } from 'svelte-zoo/stores'
import { writable } from 'svelte/store'
import type { Category, ChemicalElement } from '.'

export const active_category = writable<Category | null>(null)

export const active_element = writable<ChemicalElement | null>(null)

export const last_element = writable<ChemicalElement | null>(null)
active_element.subscribe((el) => {
  if (el !== null) last_element.set(el)
})

export const heatmap_key = writable<keyof ChemicalElement | null>(null)

export const show_icons = session_store<boolean>(`show-icons`, true)

// color values have to be in hex format as that's the only format
// <input type="color"> supports
// https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/color#value
export const default_category_colors: Record<string, string> = {
  'diatomic-nonmetal': `#ff8c00`, // darkorange
  'noble-gas': `#9932cc`, // darkorchid
  'alkali-metal': `#006400`, // darkgreen
  'alkaline-earth-metal': `#483d8b`, // darkslateblue
  metalloid: `#b8860b`, // darkgoldenrod
  'polyatomic-nonmetal': `#a52a2a`, // brown
  'transition-metal': `#571e6c`,
  'post-transition-metal': `#938d4a`,
  lanthanide: `#58748e`,
  actinide: `#6495ed`, // cornflowerblue
}
export const category_colors = session_store<Record<string, string>>(
  `category-colors`,
  { ...default_category_colors }
)

export const precision_store = session_store<number>(`elementari-precision`, 2)
