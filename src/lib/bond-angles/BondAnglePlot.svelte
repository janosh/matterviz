<script lang="ts">
  import { format_num } from '$lib/labels'
  import type { StructurePlotProps } from '$lib/plot/bar'
  import StructureBarPlot from '$lib/plot/bar/StructureBarPlot.svelte'
  import { to_structure_entries } from '$lib/plot/core/structure-input'
  import type { StructureEntry } from '$lib/plot/core/structure-input'
  import type { BarHandlerProps } from '$lib/plot/core/types'
  import { to_error } from '$lib/utils'
  import {
    bin_bond_angles,
    compute_bond_angles,
    BOND_ANGLE_DEFAULT_BIN_WIDTH,
    MAX_BOND_ANGLE,
  } from './calc-bond-angles'
  import type { BondAngleNormalizeMode, BondAngleSplitMode } from './index'
  import { type BondAngleMetadata, to_angle_bar_series } from './series'

  let {
    structures,
    strategy = `electroneg_ratio`,
    split_mode = `by_triplet`,
    normalize = `counts`,
    bin_width = BOND_ANGLE_DEFAULT_BIN_WIDTH,
    center_elements,
    neighbor_elements,
    mode = $bindable(`grouped`),
    loading = $bindable(false),
    error_msg = $bindable(),
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    ...rest
  }: StructurePlotProps & {
    split_mode?: BondAngleSplitMode
    normalize?: BondAngleNormalizeMode
    bin_width?: number
    center_elements?: readonly string[]
    neighbor_elements?: readonly string[]
  } = $props()

  let dropped_entries = $state<StructureEntry[]>([])

  // Geometry and binning are separate deriveds so dragging the bin-width slider re-bins an
  // unchanged triplet list instead of re-running the whole periodic bond search.
  const opts = $derived({ strategy, center_elements, neighbor_elements })
  const entries_with_triplets = $derived(
    [...to_structure_entries(structures), ...dropped_entries].map((entry) => ({
      ...entry,
      triplets: compute_bond_angles(entry.structure, opts),
    })),
  )

  // resolve_angle_bins throws for a bin_width outside (0, 180], and bin_width is public.
  // The failure rides back with the results because writing to a prop from inside a
  // $derived is state_unsafe_mutation.
  const binned = $derived.by(() => {
    try {
      const entries = entries_with_triplets.map((entry) => ({
        ...entry,
        data: bin_bond_angles(entry.triplets, {
          bin_width,
          split_by_triplet: split_mode === `by_triplet`,
        }),
      }))
      return { entries, failure: undefined }
    } catch (exc) {
      return { entries: [], failure: to_error(exc).message }
    }
  })
  $effect(() => {
    error_msg = binned.failure
  })

  const bar_series = $derived(to_angle_bar_series(binned.entries, split_mode, normalize))

  const angle_axis = {
    label: `Bond Angle (°)`,
    range: [0, MAX_BOND_ANGLE] as [number, number],
  }
  const value_axis = $derived({
    label: normalize === `density` ? `Density (1/°)` : `Count`,
    range: [0, null] as [number, null],
  })
</script>

<StructureBarPlot
  {...rest}
  bind:show_controls
  bind:controls_open
  series={bar_series}
  primary_axis={angle_axis}
  {value_axis}
  subject="bond angles"
  bind:dropped_entries
  bind:mode
  bind:loading
  bind:error_msg
>
  {#snippet tooltip(info: BarHandlerProps<BondAngleMetadata>)}
    {@const half_width = (info.metadata?.bin_width ?? bin_width) / 2}
    {format_num(info.x - half_width, `.1f`)}–{format_num(info.x + half_width, `.1f`)}°
    <br />
    {normalize === `density` ? `Density` : `Angles`}: {format_num(
      info.y,
      normalize === `density` ? `.4~f` : `.0f`,
    )}
  {/snippet}
</StructureBarPlot>
