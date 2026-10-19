import type { StructureInput } from '#lib/plot/core/structure-input.js'
import type { BondingStrategy } from '#lib/structure/bonding.js'
import type { ComponentProps } from 'svelte'
import type StructureBarPlot from './StructureBarPlot.svelte'

export { default as BarPlot } from './BarPlot.svelte'
export { default as BarPlotControls } from './BarPlotControls.svelte'
export { default as SpacegroupBarPlot } from './SpacegroupBarPlot.svelte'

// Props a StructureBarPlot wrapper (BondAnglePlot, CoordinationBarPlot) takes: everything the
// shell accepts minus what the wrapper derives from `structures` itself.
export type StructurePlotProps = Omit<
  ComponentProps<typeof StructureBarPlot>,
  | `series`
  | `primary_axis`
  | `value_axis`
  | `subject`
  | `empty_subject`
  | `dropped_entries`
  | `bar_sites`
> & { structures: StructureInput; strategy?: BondingStrategy }

// Maps a hovered bar to the sites it counts, per structure it draws from
export type BarSites = NonNullable<ComponentProps<typeof StructureBarPlot>[`bar_sites`]>
