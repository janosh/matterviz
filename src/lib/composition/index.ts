import type { ElementSymbol } from '$lib/element'

export { default as BarChart } from './BarChart.svelte'
export { default as BubbleChart } from './BubbleChart.svelte'
export * from './chart'
export * from './chem-sys'
export { default as Composition } from './Composition.svelte'
export * from './format'
export { default as Formula } from './Formula.svelte'
export { default as FormulaFilter } from './FormulaFilter.svelte'
export * from './parse'
export { default as PieChart } from './PieChart.svelte'

export type CompositionType = Partial<Record<ElementSymbol, number>>
export type FormulaSearchMode = `elements` | `chemsys` | `exact`
