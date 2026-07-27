import type { StructureInput } from '$lib/plot/core/structure-input'
import type { BondingStrategy } from '$lib/structure/bonding'
import type { ComponentProps } from 'svelte'
import type StructureBarPlot from './StructureBarPlot.svelte'

export { default as BarPlot } from './BarPlot.svelte'
export { default as BarPlotControls } from './BarPlotControls.svelte'
export { default as SpacegroupBarPlot } from './SpacegroupBarPlot.svelte'
export { default as StructureBarPlot } from './StructureBarPlot.svelte'

// Props a StructureBarPlot wrapper (BondAnglePlot, CoordinationBarPlot) takes: everything the
// shell accepts minus what the wrapper derives from `structures` itself.
export type StructurePlotProps = Omit<
  ComponentProps<typeof StructureBarPlot>,
  | `series`
  | `primary_axis`
  | `value_axis`
  | `subject`
  | `empty_subject`
  | `tooltip`
  | `dropped_entries`
> & { structures: StructureInput; strategy?: BondingStrategy }
