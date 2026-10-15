import type { ColorScale } from '#lib/plot/core/types.js'

export { default as PeriodicTable } from './PeriodicTable.svelte'
export { default as PropertySelect } from './PropertySelect.svelte'
export { default as TableInset } from './TableInset.svelte'

export type ScaleContext = {
  min: number
  max: number
  color_scale: ColorScale
}
