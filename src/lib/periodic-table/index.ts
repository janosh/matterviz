import type { D3InterpolateName } from '../colors'

export { default, default as PeriodicTable } from './PeriodicTable.svelte'
export { default as PropertySelect } from './PropertySelect.svelte'
export { default as TableInset } from './TableInset.svelte'

export type ScaleContext = {
  min: number
  max: number
  color_scale: D3InterpolateName | ((num: number) => string)
}
